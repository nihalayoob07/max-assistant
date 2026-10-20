// The microphone with the PC's own sound taken out: the raw mic and Windows' loopback of what the speakers
// play go through the echo canceller (aec.js), so videos and music (people talking in them too) aren't heard
// as you. Used by the wake listener and by the hologram while it listens to what you ask.
// Returns { node, streams }, or the plain mic with Chrome's processing if loopback isn't available.
'use strict';
async function cleanMic(ctx) {
  const streams = [];
  try {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    streams.push(mic);
    const loop = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    streams.push(loop);
    loop.getVideoTracks().forEach((t) => t.stop());
    if (!loop.getAudioTracks().length) throw new Error('no loopback audio');
    await ctx.audioWorklet.addModule('aec.js');
    const node = new AudioWorkletNode(ctx, 'max-aec', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    ctx.createMediaStreamSource(mic).connect(node, 0, 0);
    ctx.createMediaStreamSource(loop).connect(node, 0, 1);
    console.log('echo canceller on');
    return { node, streams };
  } catch (e) {
    console.warn('echo canceller off:', e.message);
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    return { node: ctx.createMediaStreamSource(mic), streams: [mic] };
  }
}
