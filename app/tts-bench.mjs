import { KokoroTTS } from 'kokoro-js';
const out = process.argv[2];
const text = 'You have one lead this week, a website enquiry that was marked lost. Nothing is waiting on you right now, so you are all clear. Want me to draft a follow up for it anyway?';
for (const dtype of ['q8', 'fp32', 'fp16', 'q4']) {
  try {
    let t = Date.now();
    const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype, device: 'cpu' });
    const load = Date.now() - t;
    await tts.generate('Warm up.', { voice: 'bm_george' });
    t = Date.now();
    const a = await tts.generate(text, { voice: 'bm_george' });
    const sec = a.audio.length / a.sampling_rate;
    console.log(dtype, 'load', load, 'ms | whole answer gen', Date.now() - t, 'ms for', sec.toFixed(1), 's of audio');
    await a.save(`${out}/whole-${dtype}.wav`);
  } catch (e) { console.log(dtype, 'failed:', e.message.slice(0, 100)); }
}
