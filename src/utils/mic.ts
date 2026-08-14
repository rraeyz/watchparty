// Shared mic state so both the video chat panel and the chat input row can
// drive the same microphone. Components subscribe to be re-rendered on change.

type Listener = () => void;

const listeners = new Set<Listener>();

let pushToTalk = localStorage.getItem("wp-push-to-talk") === "true";
let pttActive = false;

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeMic(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getStream(): MediaStream | undefined {
  return window.watchparty?.ourStream;
}

export function isInVoiceChat() {
  return Boolean(getStream());
}

export function isMicOn() {
  return Boolean(getStream()?.getAudioTracks()[0]?.enabled);
}

export function isPushToTalk() {
  return pushToTalk;
}

export function isPttActive() {
  return pttActive;
}

export function setMicEnabled(enabled: boolean) {
  const track = getStream()?.getAudioTracks()[0];
  if (!track || track.enabled === enabled) {
    return;
  }
  track.enabled = enabled;
  notify();
}

export function toggleMic() {
  setMicEnabled(!isMicOn());
}

export function setPttActive(active: boolean) {
  if (!pushToTalk || pttActive === active) {
    return;
  }
  pttActive = active;
  setMicEnabled(active);
  notify();
}

export function togglePushToTalk() {
  pushToTalk = !pushToTalk;
  pttActive = false;
  localStorage.setItem("wp-push-to-talk", String(pushToTalk));
  // Entering PTT mutes until the key is held; leaving it opens the mic again.
  setMicEnabled(!pushToTalk);
  notify();
}
