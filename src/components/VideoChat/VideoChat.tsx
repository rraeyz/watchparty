import React from "react";
import { ActionIcon, Button } from "@mantine/core";
import { Socket } from "socket.io-client";

import {
  formatTimestamp,
  getOrCreateClientId,
  getColorForStringHex,
  getDefaultPicture,
  iceServers,
  softWhite,
} from "../../utils/utils";
import { UserMenu } from "../UserMenu/UserMenu";
import { MetadataContext } from "../../MetadataContext";
import * as mic from "../../utils/mic";
import {
  IconDotsVertical,
  IconKeyboard,
  IconMicrophone,
  IconScreenShare,
  IconVideo,
  IconX,
} from "@tabler/icons-react";

interface VideoChatProps {
  socket: Socket;
  participants: User[];
  pictureMap: StringDict;
  nameMap: StringDict;
  tsMap: NumberDict;
  rosterUpdateTS: Number;
  hide?: boolean;
  owner: string | undefined;
  getLeaderTime: () => number;
}

export class VideoChat extends React.Component<VideoChatProps> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;

  socket = this.props.socket;

  // Push-to-talk: when on, the mic stays muted until the hotkey is held down.
  state = {
    // Map of participant id -> whether they're currently speaking
    speaking: {} as { [id: string]: boolean },
  };

  // Web Audio plumbing for the speaking indicator
  audioContext?: AudioContext;
  analysers: { [id: string]: AnalyserNode } = {};
  speakingRAF?: number;

  componentDidMount() {
    this.socket.on("signal", this.handleSignal);
    this.unsubscribeMic = mic.subscribeMic(() => this.forceUpdate());
  }

  unsubscribeMic?: () => void;

  componentWillUnmount() {
    this.socket.off("signal", this.handleSignal);
    this.unsubscribeMic?.();
    this.stopSpeakingDetection();
  }

  //=================================================
  // SPEAKING INDICATOR
  //=================================================
  // Attach an analyser to a stream so we can tell when that person is talking.
  watchStreamForSpeech = (id: string, stream: MediaStream) => {
    if (!stream.getAudioTracks().length || this.analysers[id]) {
      return;
    }
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      this.analysers[id] = analyser;
      this.startSpeakingDetection();
    } catch (e) {
      console.warn("speaking detection unavailable", e);
    }
  };

  startSpeakingDetection = () => {
    if (this.speakingRAF) {
      return;
    }
    const buffer = new Uint8Array(256);
    const tick = () => {
      const speaking: { [id: string]: boolean } = {};
      Object.entries(this.analysers).forEach(([id, analyser]) => {
        analyser.getByteFrequencyData(buffer);
        const bins = analyser.frequencyBinCount;
        let sum = 0;
        for (let i = 0; i < bins; i++) {
          sum += buffer[i];
        }
        // Rough loudness threshold — high enough to ignore background hiss
        speaking[id] = sum / bins > 12;
      });
      const changed = Object.keys(speaking).some(
        (id) => speaking[id] !== this.state.speaking[id],
      );
      if (changed) {
        this.setState({ speaking });
      }
      this.speakingRAF = requestAnimationFrame(tick);
    };
    this.speakingRAF = requestAnimationFrame(tick);
  };

  stopSpeakingDetection = () => {
    if (this.speakingRAF) {
      cancelAnimationFrame(this.speakingRAF);
      this.speakingRAF = undefined;
    }
    this.analysers = {};
    this.audioContext?.close();
    this.audioContext = undefined;
  };

  componentDidUpdate(prevProps: VideoChatProps) {
    if (this.props.rosterUpdateTS !== prevProps.rosterUpdateTS) {
      this.updateWebRTC();
    }
  }

  emitUserMute = () => {
    this.socket.emit("CMD:userMute", { isMuted: !this.getAudioWebRTC() });
  };

  //=================================================
  // SPEAKING INDICATOR
  //=================================================
  // Attach an analyser to a stream so we can tell when that person is talking.
  watchStreamForSpeech = (id: string, stream: MediaStream) => {
    if (!stream.getAudioTracks().length || this.analysers[id]) {
      return;
    }
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      this.analysers[id] = analyser;
      this.startSpeakingDetection();
    } catch (e) {
      console.warn("speaking detection unavailable", e);
    }
  };

  startSpeakingDetection = () => {
    if (this.speakingRAF) {
      return;
    }
    const buffer = new Uint8Array(256);
    const tick = () => {
      const speaking: { [id: string]: boolean } = {};
      Object.entries(this.analysers).forEach(([id, analyser]) => {
        analyser.getByteFrequencyData(buffer);
        const bins = analyser.frequencyBinCount;
        let sum = 0;
        for (let i = 0; i < bins; i++) {
          sum += buffer[i];
        }
        // Rough loudness threshold — high enough to ignore background hiss
        speaking[id] = sum / bins > 12;
      });
      const changed = Object.keys(speaking).some(
        (id) => speaking[id] !== this.state.speaking[id],
      );
      if (changed) {
        this.setState({ speaking });
      }
      this.speakingRAF = requestAnimationFrame(tick);
    };
    this.speakingRAF = requestAnimationFrame(tick);
  };

  stopSpeakingDetection = () => {
    if (this.speakingRAF) {
      cancelAnimationFrame(this.speakingRAF);
      this.speakingRAF = undefined;
    }
    this.analysers = {};
    this.audioContext?.close();
    this.audioContext = undefined;
  };

  componentDidUpdate(prevProps: VideoChatProps) {
    if (this.props.rosterUpdateTS !== prevProps.rosterUpdateTS) {
      this.updateWebRTC();
    }
  }

  emitUserMute = () => {
    this.socket.emit("CMD:userMute", { isMuted: !this.getAudioWebRTC() });
  };

  handleSignal = async (data: any) => {
    // Handle messages received from signaling server
    const msg = data.msg;
    const from = data.from;
    let pc = window.watchparty.videoPCs[from];
    if (!pc) {
      return;
    }
    console.log("recv", from, data);
    if (msg.ice !== undefined) {
      pc.addIceCandidate(new RTCIceCandidate(msg.ice));
    } else if (msg.sdp && msg.sdp.type === "offer") {
      // If our PC is stale, replace it with a fresh one before handling the offer
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        pc.close();
        delete window.watchparty.videoPCs[from];
        this.updateWebRTC();
        pc = window.watchparty.videoPCs[from];
        if (!pc) {
          return;
        }
      }
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal(from, { sdp: pc.localDescription });
    } else if (msg.sdp && msg.sdp.type === "answer") {
      pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    }
  };

  setupWebRTC = async () => {
    // Set up our own video
    // Create default stream
    let black = ({ width = 640, height = 480 } = {}) => {
      let canvas: any = Object.assign(document.createElement("canvas"), {
        width,
        height,
      });
      canvas.getContext("2d")?.fillRect(0, 0, width, height);
      let stream = canvas.captureStream();
      return Object.assign(stream.getVideoTracks()[0], { enabled: false });
    };
    let stream = new MediaStream([black()]);

    try {
      stream = await navigator?.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
    } catch (e) {
      console.warn(e);
      try {
        console.log("attempt audio only stream");
        stream = await navigator?.mediaDevices?.getUserMedia({
          audio: true,
          video: false,
        });
      } catch (e) {
        console.warn(e);
      }
    }
    window.watchparty.ourStream = stream;
    // If push-to-talk is on, start muted — the hotkey opens the mic.
    if (mic.isPushToTalk()) {
      const track = stream.getAudioTracks()[0];
      if (track) {
        track.enabled = false;
      }
    }
    // alert server we've joined video chat
    this.socket.emit("CMD:joinVideo");
    this.emitUserMute();
    this.watchStreamForSpeech(getOrCreateClientId(), stream);
  };

  stopWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    const videoPCs = window.watchparty.videoPCs;
    ourStream &&
      ourStream.getTracks().forEach((track) => {
        track.stop();
      });
    window.watchparty.ourStream = undefined;
    Object.keys(videoPCs).forEach((key) => {
      videoPCs[key].close();
      delete videoPCs[key];
    });
    this.socket.emit("CMD:leaveVideo");
  };

  toggleVideoWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    if (ourStream && ourStream.getVideoTracks()[0]) {
      ourStream.getVideoTracks()[0].enabled =
        !ourStream.getVideoTracks()[0]?.enabled;
    }
    this.forceUpdate();
  };

  getVideoWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    return ourStream && ourStream.getVideoTracks()[0]?.enabled;
  };

  toggleAudioWebRTC = () => {
    // Route through the shared module so the chat-row buttons stay in sync
    mic.toggleMic();
    this.emitUserMute();
    this.forceUpdate();
  };

  getAudioWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    return (
      ourStream &&
      ourStream.getAudioTracks()[0] &&
      ourStream.getAudioTracks()[0].enabled
    );
  };

  updateWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    const videoPCs = window.watchparty.videoPCs;
    const videoRefs = window.watchparty.videoRefs;
    if (!ourStream) {
      // We haven't started video chat, exit
      return;
    }
    const selfId = getOrCreateClientId();

    // Delete and close any connections that aren't in the current member list (maybe someone disconnected)
    // This allows them to rejoin later
    const clientIds = new Set(
      this.props.participants.filter((p) => p.isVideoChat).map((p) => p.id),
    );
    Object.entries(videoPCs).forEach(([key, value]) => {
      if (!clientIds.has(key)) {
        value.close();
        delete videoPCs[key];
      }
    });

    this.props.participants.forEach((user) => {
      const id = user.id;
      if (!user.isVideoChat || videoPCs[id]) {
        // User isn't in video chat, or we already have a connection to them
        return;
      }
      if (id === selfId) {
        videoPCs[id] = new RTCPeerConnection();
        videoRefs[id].srcObject = ourStream;
      } else {
        const pc = new RTCPeerConnection({ iceServers: iceServers() });
        videoPCs[id] = pc;
        // Add our own video as outgoing stream
        ourStream?.getTracks().forEach((track) => {
          if (ourStream) {
            pc.addTrack(track, ourStream);
          }
        });
        pc.onicecandidate = (event) => {
          // We generated an ICE candidate, send it to peer
          if (event.candidate) {
            this.sendSignal(id, { ice: event.candidate });
          }
        };
        pc.ontrack = (event: RTCTrackEvent) => {
          // Mount the stream from peer
          // console.log(stream);
          videoRefs[id].srcObject = event.streams[0];
          this.watchStreamForSpeech(id, event.streams[0]);
        };
        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === "failed") {
            // ICE failed (permanently, not a temporary disconnection, which would be "disconnected"), tear down and attempt to re-establish
            pc.close();
            delete videoPCs[id];
            this.updateWebRTC();
          }
        };
        // For each pair, have the lexicographically smaller ID be the offerer
        const isOfferer = selfId < id;
        if (isOfferer) {
          pc.onnegotiationneeded = async () => {
            // Start connection for peer's video
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignal(id, { sdp: pc.localDescription });
          };
        }
      }
    });
  };

  sendSignal = async (to: string, data: any) => {
    console.log("send", to, data);
    this.socket.emit("signal", { to, msg: data });
  };

  render() {
    const { participants, pictureMap, nameMap, tsMap, socket, owner } =
      this.props;
    const ourStream = window.watchparty.ourStream;
    const videoRefs = window.watchparty.videoRefs;
    const videoChatSize = participants.length > 2 ? 180 : 250;
    const videoChatContentStyle: React.CSSProperties = {
      height: videoChatSize,
      width: videoChatSize,
      objectFit: "cover",
      position: "relative",
    };
    const selfId = getOrCreateClientId();
    return (
      <>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "4px",
            padding: "4px",
          }}
        >
        {participants.map((p) => {
          return (
            <div key={p.id}>
              <div
                style={{
                  position: "relative",
                  // Highlight whoever is currently talking
                  outline: this.state.speaking[p.id]
                    ? "3px solid #3fb950"
                    : "3px solid transparent",
                  borderRadius: "4px",
                  transition: "outline-color 0.12s ease-out",
                }}
              >
                <div>
                  <UserMenu
                    displayName={nameMap[p.id] || p.id}
                    disabled={
                      !Boolean(owner && owner === this.context.user?.uid)
                    }
                    socket={socket}
                    userToManage={p.id}
                    trigger={
                      <IconDotsVertical
                        style={{
                          position: "absolute",
                          right: 0,
                          top: 0,
                          cursor: "pointer",
                          zIndex: 1,
                          visibility: Boolean(
                            owner && owner === this.context.user?.uid,
                          )
                            ? "visible"
                            : "hidden",
                        }}
                      />
                    }
                  />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: "4px",
                      position: "absolute",
                      top: 0,
                      left: 0,
                      zIndex: 1,
                    }}
                  >
                    {!ourStream && p.id === selfId && (
                      <Button
                        size="xs"
                        color={"purple"}
                        onClick={this.setupWebRTC}
                        leftSection={<IconVideo />}
                      >
                        Join
                      </Button>
                    )}
                    {ourStream && p.id === selfId && (
                      <Button
                        size="xs"
                        color={"red"}
                        onClick={this.stopWebRTC}
                        leftSection={<IconX />}
                      >
                        Leave
                      </Button>
                    )}
                    {ourStream && p.id === selfId && (
                      <>
                        <ActionIcon
                          color={this.getVideoWebRTC() ? "green" : "red"}
                          onClick={this.toggleVideoWebRTC}
                        >
                          <IconVideo />
                        </ActionIcon>
                        <ActionIcon
                          color={this.getAudioWebRTC() ? "green" : "red"}
                          onClick={this.toggleAudioWebRTC}
                          disabled={mic.isPushToTalk()}
                          title={
                            mic.isPushToTalk()
                              ? "Push-to-talk is on — hold Space to talk"
                              : "Toggle microphone"
                          }
                        >
                          <IconMicrophone />
                        </ActionIcon>
                        <ActionIcon
                          color={
                            !mic.isPushToTalk()
                              ? "gray"
                              : mic.isPttActive()
                                ? "green"
                                : "yellow"
                          }
                          onClick={mic.togglePushToTalk}
                          title={
                            mic.isPushToTalk()
                              ? "Push-to-talk on (hold Space). Click to switch to open mic."
                              : "Switch to push-to-talk (hold Space to talk)"
                          }
                        >
                          <IconKeyboard />
                        </ActionIcon>
                      </>
                    )}
                    {p.id !== selfId && (
                      <>
                        {p.isVideoChat && <IconVideo color={softWhite} />}
                        {p.isVideoChat && (
                          <IconMicrophone
                            color={p.isMuted ? "red" : softWhite}
                          />
                        )}
                      </>
                    )}
                    {p.isScreenShare && <IconScreenShare color={softWhite} />}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      bottom: "4px",
                      left: "0px",
                      width: "100%",
                      backgroundColor: "rgba(0,0,0,0)",
                      color: softWhite,
                      borderRadius: "4px",
                      fontSize: "10px",
                      fontWeight: 700,
                      display: "flex",
                      zIndex: 1,
                    }}
                  >
                    <div
                      title={nameMap[p.id] || p.id}
                      style={{
                        backdropFilter: "brightness(80%)",
                        padding: "4px",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        display: "inline-block",
                      }}
                    >
                      {nameMap[p.id] || p.id}
                    </div>
                    <div
                      style={{
                        backdropFilter: "brightness(60%)",
                        padding: "4px",
                        flexGrow: 1,
                        display: "flex",
                        justifyContent: "center",
                      }}
                    >
                      {formatTimestamp(tsMap[p.id] || 0)}{" "}
                      {/* {this.context.beta &&
                          `(${(
                            (tsMap[p.id] - this.props.getLeaderTime()) *
                            1000
                          ).toFixed(0)}ms)`} */}
                    </div>
                  </div>
                  {ourStream && p.isVideoChat ? (
                    <video
                      ref={(el) => {
                        if (el) {
                          videoRefs[p.id] = el;
                        }
                      }}
                      style={{
                        ...videoChatContentStyle,
                        // mirror the video if it's our stream. this style mimics Zoom where your
                        // video is mirrored only for you)
                        transform: `scaleX(${p.id === selfId ? "-1" : "1"})`,
                      }}
                      autoPlay
                      muted={p.id === selfId}
                      data-id={p.id}
                    />
                  ) : (
                    <img
                      style={videoChatContentStyle}
                      src={
                        pictureMap[p.id] ||
                        getDefaultPicture(
                          nameMap[p.id],
                          getColorForStringHex(p.id),
                        )
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
        </div>
      </>
    );
  }
}
