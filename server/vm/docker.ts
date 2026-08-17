// This assumes an installation of Docker exists on the given host
// and that host is configured to accept our SSH key
import config from "../config.ts";
import { VMManager, type VM } from "./base.ts";
import { imageName } from "./utils.ts";
import fs from "node:fs";
import { homedir } from "node:os";
import { NodeSSH } from "node-ssh";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Matches the subset of NodeSSH we actually use, so the rest of this class
// doesn't care whether commands run over SSH or on the local Docker socket.
type CommandRunner = {
  execCommand: (
    cmd: string,
  ) => Promise<{ stdout: string; stderr: string }>;
};

// When the app already has access to the Docker socket (e.g. it's mounted into
// the container), running commands locally avoids needing SSH keys entirely.
const localRunner: CommandRunner = {
  execCommand: async (cmd: string) => {
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        maxBuffer: 10 * 1024 * 1024,
        // The startVM script uses process substitution, which is bash-only —
        // the default /bin/sh is busybox ash on Alpine and would fail silently.
        shell: "/bin/bash",
      });
      return { stdout, stderr };
    } catch (e: any) {
      console.error("[DOCKER] command failed:", e?.message);
      return { stdout: e?.stdout ?? "", stderr: e?.stderr ?? String(e) };
    }
  },
};

export class Docker extends VMManager {
  // TODO support multiple Docker providers in the pool config with same region
  size = "";
  largeSize = "";
  minRetries = 0;
  reuseVMs = false;
  id = "Docker";
  ssh: NodeSSH | undefined = undefined;
  imageId = imageName;

  getSSH = async (): Promise<CommandRunner> => {
    if (config.VBROWSER_USE_DOCKER_SOCKET) {
      return localRunner;
    }
    if (this.ssh && this.ssh.isConnected()) {
      return this.ssh;
    }
    const sshConfig = {
      username: config.DOCKER_VM_HOST_SSH_USER,
      host: this.hostname,
      // The private key the Docker host is configured to accept
      privateKey: config.DOCKER_VM_HOST_SSH_KEY_BASE64
        ? Buffer.from(config.DOCKER_VM_HOST_SSH_KEY_BASE64, "base64").toString()
        : fs.readFileSync(homedir() + "/.ssh/id_rsa").toString(),
    };
    this.ssh = new NodeSSH();
    await this.ssh.connect(sshConfig);
    return this.ssh;
  };

  startVM = async (name: string) => {
    const tag = this.getTag();
    const conn = await this.getSSH();
    // Neko serves its own TLS when we point it at a cert. That's necessary
    // because the page is loaded over https and browsers refuse to open an
    // insecure websocket from it. Mounting the host's letsencrypt dir (below)
    // lets it reuse the domain's existing certificate.
    const sslEnv =
      config.VBROWSER_SSL_KEY_FILE && config.VBROWSER_SSL_CRT_FILE
        ? `-e NEKO_KEY="${config.VBROWSER_SSL_KEY_FILE}" -e NEKO_CERT="${config.VBROWSER_SSL_CRT_FILE}"`
        : "";
    // Mount the directory holding those certs into the neko container
    const sslMount = config.VBROWSER_SSL_MOUNT
      ? `-v ${config.VBROWSER_SSL_MOUNT}:${config.VBROWSER_SSL_MOUNT}:ro`
      : "";
    // Behind NAT (Oracle, most clouds) neko can't discover the address clients
    // should connect to, so tell it explicitly. ICE-lite also halves the number
    // of UDP ports each viewer needs.
    const natEnv = config.VBROWSER_NAT1TO1
      ? `-e NEKO_NAT1TO1="${config.VBROWSER_NAT1TO1}" -e NEKO_ICELITE="1"`
      : "";
    const { stdout, stderr } = await conn.execCommand(
      `
      #!/bin/bash
      set -e
      # Find a free port in 5000-5063. Ask Docker which ones it has published
      # rather than using ss: when this runs inside a container, ss only sees
      # the container's own network namespace, not the host's.
      USED=$(docker ps --format '{{.Ports}}' | grep -oE ':[0-9]+->' | tr -d ':>-' | sort -u)
      PORT=$(comm -23 <(seq 5000 5063 | sort) <(echo "$USED" | sort -u) | sort -n | head -n 1)
      if [ -z "$PORT" ]; then echo "no free port" >&2; exit 1; fi
      INDEX=$(($PORT - 5000))
      UDP_START=$((59000+$INDEX*100))
      UDP_END=$((59099+$INDEX*100))
      docker run -d --rm --name=${name} --memory="2g" --cpus="2" -p $PORT:$PORT -p $UDP_START-$UDP_END:$UDP_START-$UDP_END/udp ${sslMount} -l ${tag} -l index=$INDEX --log-opt max-size=1g --shm-size=2g --cap-add="SYS_ADMIN" ${sslEnv} ${natEnv} -e DISPLAY=":99.0" -e NEKO_PASSWORD=${name} -e NEKO_PASSWORD_ADMIN=${name} -e NEKO_ADMIN_KEY=${config.VBROWSER_ADMIN_KEY} -e NEKO_BIND=":$PORT" -e NEKO_EPR="$UDP_START-$UDP_END" -e NEKO_H264="1" ${imageName}
      `,
    );
    if (stderr) {
      console.log("[DOCKER] startVM stderr:", stderr);
    }
    console.log("[DOCKER] startVM id:", stdout.trim());
    return stdout.trim();
  };

  terminateVM = async (id: string) => {
    const conn = await this.getSSH();
    const { stdout, stderr } = await conn.execCommand(`docker rm -fv ${id}`);
    console.log(stdout, stderr);
    return;
  };

  rebootVM = async (id: string) => {
    // Docker containers aren't set to reuse, so do nothing (reset will terminate)
  };

  reimageVM = async (id: string) => {
    const conn = await this.getSSH();
    const { stdout, stderr } = await conn.execCommand(
      `docker pull ${this.imageId}`,
    );
    console.log(stdout, stderr);
    // The container is out of date. Delete it
    this.terminateVMWrapper(id);
    return;
  };

  getVM = async (id: string) => {
    const conn = await this.getSSH();
    const { stdout } = await conn.execCommand(`docker inspect ${id}`);
    let data = null;
    try {
      data = JSON.parse(stdout)[0];
      if (!data) {
        throw new Error("no container with this ID found");
      }
    } catch {
      console.warn(stdout);
      throw new Error("failed to parse json");
    }
    let server = this.mapServerObject(data);
    return server;
  };

  listVMs = async (filter: string) => {
    const conn = await this.getSSH();
    const listCmd = `docker inspect $(docker ps --filter label=${filter} --quiet --no-trunc)`;
    const { stdout } = await conn.execCommand(listCmd);
    if (!stdout) {
      return [];
    }
    let data = [];
    try {
      data = JSON.parse(stdout);
    } catch (e) {
      console.warn(stdout);
      throw new Error("failed to parse json");
    }
    return data.map(this.mapServerObject);
  };

  powerOn = async (id: string) => {};

  attachToNetwork = async (id: string) => {};

  updateSnapshot = async () => {
    return "";
  };

  mapServerObject = (server: any): VM => ({
    id: server.Id,
    host: `${this.hostname}:${5000 + Number(server.Config?.Labels?.index)}`,
    provider: this.id,
    large: this.isLarge,
    region: this.region,
  });
}
