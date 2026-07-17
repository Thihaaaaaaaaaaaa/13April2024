/* A quiet soundscape for the garden — wind through grass, the odd
   wind-chime note, crickets at the edge. All synthesized, nothing
   loaded, and silent until the person asks for it. */

export function createAmbient() {
  let ctx = null, master = null, timers = [], on = false;

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    /* ---- wind: looped filtered noise with a slow breathing gain ---- */
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {           // pinkish noise
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    const wind = ctx.createBufferSource();
    wind.buffer = buf; wind.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
    const windGain = ctx.createGain(); windGain.gain.value = 0.05;
    wind.connect(lp); lp.connect(windGain); windGain.connect(master);
    wind.start();
    const breathe = () => {
      if (!ctx) return;
      windGain.gain.setTargetAtTime(0.03 + Math.random() * 0.06, ctx.currentTime, 2.5);
      lp.frequency.setTargetAtTime(300 + Math.random() * 400, ctx.currentTime, 3);
      timers.push(setTimeout(breathe, 3800 + Math.random() * 4200));
    };
    breathe();

    /* ---- chimes: sparse pentatonic notes, far away ---- */
    const NOTES = [220, 246.9, 277.2, 329.6, 370, 440];   // A major pentatonic
    const chime = () => {
      if (!ctx) return;
      const count = 1 + (Math.random() < 0.35 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const f = NOTES[(Math.random() * NOTES.length) | 0] * (Math.random() < 0.3 ? 2 : 1);
        const t = ctx.currentTime + i * (0.22 + Math.random() * 0.3);
        const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
        const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.01;
        const gn = ctx.createGain(); gn.gain.value = 0;
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        o1.connect(gn); o2.connect(gn);
        if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; gn.connect(pan); pan.connect(master); }
        else gn.connect(master);
        gn.gain.setValueAtTime(0, t);
        gn.gain.linearRampToValueAtTime(0.028, t + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.0004, t + 3.4);
        o1.start(t); o2.start(t); o1.stop(t + 3.6); o2.stop(t + 3.6);
      }
      timers.push(setTimeout(chime, 8000 + Math.random() * 15000));
    };
    timers.push(setTimeout(chime, 3000));

    /* ---- crickets: two of them, trading chirps ---- */
    const cricket = pan => {
      const go = () => {
        if (!ctx) return;
        const pulses = 3 + ((Math.random() * 3) | 0);
        for (let i = 0; i < pulses; i++) {
          const t = ctx.currentTime + i * 0.062;
          const dur = 0.03;
          const nb = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
          const nd = nb.getChannelData(0);
          for (let k = 0; k < nd.length; k++) nd[k] = (Math.random() * 2 - 1) * (1 - k / nd.length);
          const src = ctx.createBufferSource(); src.buffer = nb;
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
          bp.frequency.value = 4100 + Math.random() * 500; bp.Q.value = 9;
          const gn = ctx.createGain(); gn.gain.value = 0.012;
          const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
          src.connect(bp); bp.connect(gn);
          if (pn) { pn.pan.value = pan; gn.connect(pn); pn.connect(master); } else gn.connect(master);
          src.start(t);
        }
        timers.push(setTimeout(go, 700 + Math.random() * 1800));
      };
      timers.push(setTimeout(go, Math.random() * 1500));
    };
    cricket(-0.7); cricket(0.65);
  }

  return {
    get on() { return on; },
    async toggle() {
      on = !on;
      if (on) {
        if (!ctx) build();
        if (ctx.state === 'suspended') await ctx.resume();
        master.gain.setTargetAtTime(1.0, ctx.currentTime, 0.6);
      } else if (ctx) {
        master.gain.setTargetAtTime(0.0, ctx.currentTime, 0.4);
      }
      return on;
    },
  };
}
