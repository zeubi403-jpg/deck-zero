/*! Deck Zero optical terminal — shared diegetic helpers (audio / optics / meta) */
(function (global) {
  "use strict";

  var reduce =
    global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse =
    global.matchMedia && global.matchMedia("(pointer:coarse)").matches;

  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (_) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (_) {}
  }

  /* —— Absolute Open Graph / canonical —— */
  function absUrl(rel) {
    try {
      return new URL(rel, location.href).href;
    } catch (_) {
      return rel;
    }
  }
  function ensureMeta(prop, content, isName) {
    var sel = isName
      ? 'meta[name="' + prop + '"]'
      : 'meta[property="' + prop + '"]';
    var el = document.querySelector(sel);
    if (!el) {
      el = document.createElement("meta");
      if (isName) el.setAttribute("name", prop);
      else el.setAttribute("property", prop);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }
  function fixMeta() {
    var pageUrl = location.href.split("#")[0];
    var og = document.querySelector('meta[property="og:image"]');
    if (og) og.setAttribute("content", absUrl("og.png"));
    var tw = document.querySelector('meta[name="twitter:image"]');
    if (tw) tw.setAttribute("content", absUrl("og.png"));
    ensureMeta("og:url", pageUrl, false);
    ensureMeta("twitter:url", pageUrl, true);
    var title = document.title || "Deck Zero";
    ensureMeta("og:title", title, false);
    ensureMeta("twitter:title", title, true);
    var desc = document.querySelector('meta[name="description"]');
    if (desc && desc.content) {
      ensureMeta("og:description", desc.content, false);
      ensureMeta("twitter:description", desc.content, true);
    }
    var can = document.querySelector('link[rel="canonical"]');
    if (!can) {
      can = document.createElement("link");
      can.rel = "canonical";
      document.head.appendChild(can);
    }
    can.href = pageUrl;
    var icon = document.querySelector('link[rel="icon"]');
    if (icon && icon.getAttribute("href") === "favicon.svg") {
      icon.setAttribute("href", absUrl("favicon.svg"));
    }
  }

  /* —— Optics LO (user choice only — never force phone to look cheaper) —— */
  var opticsLo = lsGet("dz_optics_lo") === "1";
  function applyOptics() {
    document.documentElement.classList.toggle("optics-lo", opticsLo);
    document.body && document.body.classList.toggle("optics-lo", opticsLo);
  }
  function setOpticsLo(on) {
    opticsLo = !!on;
    lsSet("dz_optics_lo", opticsLo ? "1" : "0");
    applyOptics();
    syncOptControls();
  }
  function syncOptControls() {
    document.querySelectorAll("[data-optics-lo]").forEach(function (b) {
      b.classList.toggle("on", opticsLo);
      b.setAttribute("aria-pressed", opticsLo ? "true" : "false");
      var lang = document.documentElement.lang === "fr" ? "fr" : "en";
      b.title = opticsLo
        ? lang === "fr"
          ? "Affichage atténué (actif)"
          : "Low optics (on)"
        : lang === "fr"
          ? "Atténuer l’affichage"
          : "Low optics";
    });
  }

  /* —— Audio (Web Audio + sparse Faraday samples) ——
     IDENTITY: Heresy-METHOD Faraday dark ambient (method only — no samples/stems/
     quotes; never name the influence on public glass).
     Twin abyss sub · authored ritual_cry/ritual_horn WAV body (processed multiphonic
     scream formants) + thin WebAudio thicken · crypt verb + dark delay · sat.
     Pattern: cry → long void → sub. NOT club · NOT pad · NOT siren/alarm.
     UI = clac + bip still cut through; AUD mute default.
     Duck bedBus on page-turn. */
  /* AUD mute default — only explicit "0" (user turned bed on) unmutes.
     Explicit AUD click sets audioForced so prefers-reduced-motion cannot block bed. */
  var audioForced = lsGet("dz_mute") === "0";
  var muted = lsGet("dz_mute") !== "0";
  var ctx = null;
  var master = null;
  var bedBus = null;
  var uiBus = null;
  var bedGroup = null;
  var humNodes = null;
  var humGen = 0;
  var unlocked = false;
  /* Dense reading panels (Chronology) keep pulse/grid off. */
  var readFocus = false;
  /* Bed mood: thin (index/boot) · story · tension (Contact/Board/Hatch) · archive (Chronology/Names). */
  var bedMood = "story";
  var MOOD_SCALE = {
    /* cry = ritual presence · cryGap = silence multiplier · under = continuous wash (keep tiny). */
    thin: { cine: 0.45, land: 0.25, ice: 0.2, bow: 0.35, brass: 0.25, bell: 0.25, metal: 0.35, delay: 0.55, cry: 0.55, cryGap: 1.5, under: 0.25 },
    story: { cine: 0.55, land: 0.3, ice: 0.25, bow: 0.7, brass: 0.55, bell: 0.4, metal: 0.55, delay: 0.75, cry: 1, cryGap: 1, under: 0.35 },
    /* Contact / Board|Poste / Hatch — cry closer, less void between. */
    tension: { cine: 0.48, land: 0.22, ice: 0.2, bow: 0.85, brass: 0.7, bell: 0.45, metal: 0.65, delay: 0.9, cry: 1.4, cryGap: 0.65, under: 0.4 },
    /* Chronology/Names — almost only sub + verb tails; cry distant/rare. */
    archive: { cine: 0.28, land: 0.12, ice: 0.1, bow: 0.55, brass: 0.22, bell: 0.15, metal: 0.22, delay: 0.4, cry: 0.28, cryGap: 2.4, under: 0.12 },
  };
  function moodOf() {
    return MOOD_SCALE[bedMood] || MOOD_SCALE.story;
  }
  /* Phone speakers rarely pass true sub (~58 Hz). Coarse/touch → soft mid body
     (kept below UI band so clac/bip still read). */
  var phoneAudio =
    coarse ||
    (global.matchMedia &&
      global.matchMedia("(hover: none) and (pointer: coarse)").matches) ||
    /iPhone|iPad|iPod|Android/i.test(global.navigator && global.navigator.userAgent);

  function makeColdSatCurve(amount) {
    var n = 2048;
    var curve = new Float32Array(n);
    var a = amount == null ? 2.4 : amount;
    for (var i = 0; i < n; i++) {
      var x = (i * 2) / n - 1;
      /* Cold / crisp: soft fold + slight odd edge — not warm tube. */
      var y = Math.tanh(x * a) + 0.08 * Math.sin(x * Math.PI * 2.2);
      curve[i] = y * 0.92;
    }
    return curve;
  }

  function makeOpticalImpulse(c, secOpt, earlyMute) {
    /* Cathedral/crypt void — long dark decay; early energy muted; HP on returns later. */
    var sec = secOpt != null ? secOpt : phoneAudio ? 4.2 : 6.8;
    var early = earlyMute != null ? earlyMute : 0.28;
    var len = Math.floor(c.sampleRate * sec);
    var buf = c.createBuffer(2, len, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        /* Geological tail — almost no early slap (crypt, not bright plate). */
        var env = Math.pow(1 - t, 1.05) * (0.28 + 0.72 * Math.pow(1 - t, 2.8));
        var n = (Math.random() * 2 - 1) * env;
        if (i < c.sampleRate * 0.1) n *= early;
        if (t > 0.22) n *= 0.88;
        if (t > 0.5) n *= 0.72;
        if (t > 0.75) n *= 0.55;
        d[i] = n * (ch ? 0.76 : 1) * 0.58;
      }
    }
    return buf;
  }

  function bedAllowed() {
    return !muted && (!reduce || audioForced);
  }

  function ensureCtx() {
    if (!bedAllowed()) return null;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);

      /* Dual optical verb: shorter chamber + longer crypt/abyss void.
         Pre-delay keeps attacks readable before bloom into void. */
      var chamberVerb = ctx.createConvolver();
      chamberVerb.buffer = makeOpticalImpulse(ctx, phoneAudio ? 1.35 : 1.9, 0.42);
      var abyssVerb = ctx.createConvolver();
      abyssVerb.buffer = makeOpticalImpulse(ctx, phoneAudio ? 4.4 : 7.0, 0.22);
      /* Keep `verb` alias = abyss (existing cry/horn sends). */
      var verb = abyssVerb;
      var verbPreDelay = ctx.createDelay(0.2);
      verbPreDelay.delayTime.value = phoneAudio ? 0.048 : 0.072;
      var chamberHp = ctx.createBiquadFilter();
      chamberHp.type = "highpass";
      chamberHp.frequency.value = phoneAudio ? 120 : 95;
      var chamberLp = ctx.createBiquadFilter();
      chamberLp.type = "lowpass";
      chamberLp.frequency.value = phoneAudio ? 1800 : 1600;
      var chamberWet = ctx.createGain();
      chamberWet.gain.value = phoneAudio ? 0.28 : 0.34;
      chamberVerb.connect(chamberHp);
      chamberHp.connect(chamberLp);
      chamberLp.connect(chamberWet);
      var verbHp = ctx.createBiquadFilter();
      verbHp.type = "highpass";
      /* Dark returns — cut hiss scream without killing abyss body. */
      verbHp.frequency.value = phoneAudio ? 85 : 62;
      var verbLp = ctx.createBiquadFilter();
      verbLp.type = "lowpass";
      /* Cathedral void stays under safety ceiling. */
      verbLp.frequency.value = phoneAudio ? 1500 : 1300;
      var verbWet = ctx.createGain();
      /* Vast wet room — dry bed sits under the void. */
      verbWet.gain.value = phoneAudio ? 0.62 : 0.78;
      abyssVerb.connect(verbHp);
      verbHp.connect(verbLp);
      verbLp.connect(verbWet);

      /* Bed group: dry + cold sat → mix → glue → safety LP → master.
         UI bus stays on master (full band) so clac/bip cut through. */
      bedBus = ctx.createGain();
      bedBus.gain.value = 1;
      var bedPre = ctx.createGain();
      bedPre.gain.value = 1;
      bedBus.connect(bedPre);

      var bedMix = ctx.createGain();
      bedMix.gain.value = 1;
      var dry = ctx.createGain();
      /* Drier dry path → cathedral verb carries ritual cry/gong. */
      dry.gain.value = 0.22;
      bedPre.connect(dry);
      dry.connect(bedMix);

      var satIn = ctx.createGain();
      satIn.gain.value = 0.55;
      var shaper = ctx.createWaveShaper();
      shaper.curve = makeColdSatCurve(2.1);
      shaper.oversample = "2x";
      var satHp = ctx.createBiquadFilter();
      satHp.type = "highpass";
      satHp.frequency.value = 180;
      var satBp = ctx.createBiquadFilter();
      satBp.type = "peaking";
      satBp.frequency.value = 780;
      satBp.Q.value = 0.7;
      satBp.gain.value = 1.4;
      var satLp = ctx.createBiquadFilter();
      satLp.type = "lowpass";
      satLp.frequency.value = 3000;
      var satWet = ctx.createGain();
      satWet.gain.value = 0.1;
      bedPre.connect(satIn);
      satIn.connect(shaper);
      shaper.connect(satHp);
      satHp.connect(satBp);
      satBp.connect(satLp);
      satLp.connect(satWet);
      satWet.connect(bedMix);

      var verbSend = ctx.createGain();
      verbSend.gain.value = phoneAudio ? 0.42 : 0.52;
      var chamberSend = ctx.createGain();
      chamberSend.gain.value = phoneAudio ? 0.32 : 0.4;
      bedPre.connect(verbSend);
      verbSend.connect(verbPreDelay);
      verbPreDelay.connect(abyssVerb);
      bedPre.connect(chamberSend);
      chamberSend.connect(chamberVerb);

      var glue = ctx.createDynamicsCompressor();
      glue.threshold.value = -24;
      glue.knee.value = 18;
      glue.ratio.value = 2.2;
      glue.attack.value = 0.04;
      glue.release.value = 0.38;
      /* Hard safety ceiling — kills near-ultrasonic bed energy. */
      var bedSafetyLp = ctx.createBiquadFilter();
      bedSafetyLp.type = "lowpass";
      bedSafetyLp.frequency.value = phoneAudio ? 5200 : 5600;
      bedSafetyLp.Q.value = 0.65;
      /* Gentle bed air HP — clears mud without thinning sub (sub bypasses via dry path body). */
      var bedAirHp = ctx.createBiquadFilter();
      bedAirHp.type = "highpass";
      bedAirHp.frequency.value = phoneAudio ? 28 : 22;
      bedAirHp.Q.value = 0.5;
      bedMix.connect(bedAirHp);
      bedAirHp.connect(glue);
      glue.connect(bedSafetyLp);
      bedSafetyLp.connect(master);
      verbWet.connect(bedSafetyLp);
      chamberWet.connect(bedSafetyLp);

      bedGroup = {
        verb: verb,
        chamberVerb: chamberVerb,
        abyssVerb: abyssVerb,
        verbWet: verbWet,
        chamberWet: chamberWet,
        verbSend: verbSend,
        chamberSend: chamberSend,
        verbPreDelay: verbPreDelay,
        satWet: satWet,
        dry: dry,
        glue: glue,
        bedSafetyLp: bedSafetyLp,
        bedPre: bedPre,
        bedMix: bedMix,
      };

      /* UI: dry for clarity + tiny shared verb so clicks sit in the same room. */
      uiBus = ctx.createGain();
      uiBus.gain.value = 1;
      uiBus.connect(master);
      var uiSend = ctx.createGain();
      uiSend.gain.value = 0.075;
      uiBus.connect(uiSend);
      uiSend.connect(verb);
      bedGroup.uiSend = uiSend;
    }
    /* Never burn CPU/audio while muted — resume only on explicit unmute path. */
    if (ctx.state === "suspended" && !muted) {
      try {
        ctx.resume();
      } catch (_) {}
    }
    unlocked = true;
    return ctx;
  }

  function suspendBedCtx() {
    if (!ctx) return;
    try {
      if (ctx.state === "running") ctx.suspend();
    } catch (_) {}
  }

  function bedTarget() {
    /* Soft sub under horns — must NOT read as the whole bed (pad wash). */
    if (opticsLo) return phoneAudio ? 0.008 : 0.007;
    return phoneAudio ? 0.012 : 0.01;
  }

  function hissTarget() {
    /* Thin cathode air only — never white-noise bed. */
    if (opticsLo) return phoneAudio ? 0.0028 : 0.002;
    return phoneAudio ? 0.0045 : 0.0032;
  }

  /* Sparse optical one-shots only — no kick/hat/clap/ride club pack. */
  var SAMPLE_NAMES = ["rim", "tex_hit", "stab", "ritual_cry", "ritual_horn"];
  var sampleBufs = {};
  var samplesReady = false;
  var samplesLoading = null;

  function loadBedSamples(c) {
    if (samplesReady) return Promise.resolve();
    if (samplesLoading) return samplesLoading;
    samplesLoading = Promise.all(
      SAMPLE_NAMES.map(function (name) {
        return fetch(absUrl("audio/" + name + ".wav"))
          .then(function (r) {
            if (!r.ok) throw new Error("sample " + name);
            return r.arrayBuffer();
          })
          .then(function (ab) {
            return c.decodeAudioData(ab.slice(0));
          })
          .then(function (buf) {
            sampleBufs[name] = buf;
          })
          .catch(function () {
            sampleBufs[name] = null;
          });
      })
    ).then(function () {
      samplesReady = SAMPLE_NAMES.some(function (n) {
        return !!sampleBufs[n];
      });
      samplesLoading = null;
    });
    return samplesLoading;
  }

  function playSample(c, name, dest, peak, when) {
    var buf = sampleBufs[name];
    if (!buf || !dest) return false;
    var t0 = when == null ? c.currentTime : when;
    var src = c.createBufferSource();
    var g = c.createGain();
    src.buffer = buf;
    g.gain.value = 0;
    src.connect(g);
    g.connect(dest);
    var pk = peak == null ? 0.4 : peak;
    g.gain.linearRampToValueAtTime(pk, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.min(0.45, buf.duration + 0.02));
    src.start(t0);
    src.stop(t0 + buf.duration + 0.05);
    return true;
  }

  function duckBed(ms, depth) {
    if (!bedBus || !ctx) return;
    var t0 = ctx.currentTime;
    var base = 1;
    var dip = Math.max(0.35, 1 - (depth == null ? 0.38 : depth));
    var dur = (ms || 90) / 1000;
    try {
      bedBus.gain.cancelScheduledValues(t0);
      bedBus.gain.setValueAtTime(bedBus.gain.value, t0);
      bedBus.gain.linearRampToValueAtTime(dip, t0 + 0.012);
      bedBus.gain.linearRampToValueAtTime(base, t0 + dur);
    } catch (_) {}
    /* Extra pulse-stem dip so kicks never mask clac+bip. */
    try {
      if (humNodes && humNodes.stemPulse) {
        var st = humNodes.stemPulse;
        var cur = Math.max(0.0001, st.gain.value);
        st.gain.cancelScheduledValues(t0);
        st.gain.setValueAtTime(cur, t0);
        st.gain.linearRampToValueAtTime(cur * 0.22, t0 + 0.01);
        st.gain.linearRampToValueAtTime(cur, t0 + Math.max(0.12, dur));
      }
    } catch (_) {}
  }

  /* Soft pink bed for phosphor / tape air (looping buffer). */
  var hissBuf = null;
  function pinkBuffer(c) {
    if (hissBuf && hissBuf.sampleRate === c.sampleRate) return hissBuf;
    var n = Math.floor(c.sampleRate * 2.4);
    var buf = c.createBuffer(1, n, c.sampleRate);
    var data = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < n; i++) {
      var w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      var pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      data[i] = pink * 0.11;
    }
    hissBuf = buf;
    return buf;
  }

  function stopHum() {
    if (!humNodes) return;
    var dying = humNodes;
    humNodes = null;
    humGen += 1;
    try {
      ["crackleTimer", "atmTimer", "pulseTimer", "dropTimer", "dropEndTimer", "dropTaperTimer", "hushWatchTimer", "vacuumTimer", "ritualTimer", "cryTimer"].forEach(function (k) {
        if (dying[k]) {
          clearTimeout(dying[k]);
          dying[k] = null;
        }
      });
      if (dying.gain && ctx) {
        dying.gain.gain.cancelScheduledValues(ctx.currentTime);
        dying.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
      }
      ["chordGain", "whineGain", "texGain", "hissGain", "pulseGain", "shimGain", "abyssGain", "abyss2Gain", "bowGain", "hornGain", "midHornGain", "ritualGain", "landGain", "horizonGain", "windGain", "iceGain", "gongGain", "metalGain"].forEach(function (k) {
        if (dying[k] && ctx) {
          try {
            dying[k].gain.cancelScheduledValues(ctx.currentTime);
            dying[k].gain.linearRampToValueAtTime(0, ctx.currentTime + 0.18);
          } catch (_) {}
        }
      });
      setTimeout(function () {
        try {
          (dying.oscs || []).forEach(function (o) {
            try {
              o.stop();
            } catch (_) {}
          });
          ["hissSrc", "texSrc", "windSrc", "metalSrc", "hornAirSrc", "ritualNoiseSrc"].forEach(function (k) {
            if (dying[k]) {
              try {
                dying[k].stop();
              } catch (_) {}
            }
          });
        } catch (_) {}
      }, 260);
    } catch (_) {}
  }

  function startHum() {
    if (!bedAllowed()) return;
    var c = ensureCtx();
    if (!c || humNodes || !bedBus || !bedGroup) return;
    function build() {
      if (humNodes || !bedAllowed() || !bedBus) return;
    var osc1 = c.createOscillator();
    var osc2 = c.createOscillator();
      var oscBody = c.createOscillator();
      var oscAir = c.createOscillator();
    var lfo = c.createOscillator();
    var lfoGain = c.createGain();
    var gain = c.createGain();
    var filter = c.createBiquadFilter();
      var shelf = c.createBiquadFilter();
      var bodyGain = c.createGain();
      var airGain = c.createGain();
      /* Sub / low — headphones & desktop. Soft fundamental, not a club kick. */
    osc1.type = "sine";
      osc1.frequency.value = 58;
      osc2.type = "sine";
      osc2.frequency.value = 87;
      /* Phone-passband body — warmth only; stay under UI (~1–4 kHz). */
      oscBody.type = "sine";
      oscBody.frequency.value = phoneAudio ? 174 : 145;
      bodyGain.gain.value = phoneAudio ? (opticsLo ? 0.38 : 0.52) : opticsLo ? 0.22 : 0.34;
      oscAir.type = "triangle";
      oscAir.frequency.value = phoneAudio ? 232 : 203;
      airGain.gain.value = phoneAudio ? (opticsLo ? 0.12 : 0.18) : opticsLo ? 0.07 : 0.11;
      /* Quiet odd harmonic — crisp mid-bass edge, sub stays clean. */
      var oscOdd = c.createOscillator();
      var oddHp = c.createBiquadFilter();
      var oddGain = c.createGain();
      oscOdd.type = "triangle";
      oscOdd.frequency.value = 116;
      oddHp.type = "highpass";
      oddHp.frequency.value = 200;
      oddGain.gain.value = phoneAudio ? (opticsLo ? 0.08 : 0.14) : opticsLo ? 0.06 : 0.11;
    lfo.type = "sine";
      lfo.frequency.value = 0.055;
      lfoGain.gain.value = phoneAudio ? 0.01 : 0.007;
    filter.type = "lowpass";
      filter.frequency.value = phoneAudio ? 420 : 280;
      filter.Q.value = 0.55;
      /* Cut upper mids so clac/bip have a clear lane. */
      shelf.type = "highshelf";
      shelf.frequency.value = 900;
      shelf.gain.value = phoneAudio ? -7 : -10;
    gain.gain.value = 0;
      /* Half-time AM — bass breathes with the grid (shallow). */
      var bassAm = c.createGain();
      var bassAmLfo = c.createOscillator();
      var bassAmDepth = c.createGain();
      bassAm.gain.value = 1;
      bassAmLfo.type = "sine";
      bassAmLfo.frequency.value = 52 / 60;
      bassAmDepth.gain.value = 0.0001;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    osc1.connect(filter);
    osc2.connect(filter);
      oscBody.connect(bodyGain);
      bodyGain.connect(filter);
      oscAir.connect(airGain);
      airGain.connect(filter);
      oscOdd.connect(oddHp);
      oddHp.connect(oddGain);
      oddGain.connect(filter);
      filter.connect(shelf);
      shelf.connect(gain);
      gain.connect(bassAm);
      bassAmLfo.connect(bassAmDepth);
      bassAmDepth.connect(bassAm.gain);
      /* Modular stems (Red Armor steal: mute/unmute layers, one shared group). */
      var stemBass = c.createGain();
      var stemHiss = c.createGain();
      var stemPulse = c.createGain();
      var stemShim = c.createGain();
      var stemTex = c.createGain();
      stemBass.gain.value = 1;
      stemHiss.gain.value = 1;
      stemPulse.gain.value = 0.0001;
      stemShim.gain.value = 0.44;
      stemTex.gain.value = 0.85;
      bassAm.connect(stemBass);
      stemBass.connect(bedBus);
      stemTex.connect(bedBus);
      bedBus.gain.value = 1;

      /* Cold pad — 3 voices, 4-chord progression i→VI→III→VII on 8-bar grid. */
      var chord1 = c.createOscillator();
      var chord2 = c.createOscillator();
      var chord3 = c.createOscillator();
      var chordFilter = c.createBiquadFilter();
      var chordGain = c.createGain();
      var padRootHz = 87;
      /* Blindsight intervals — not stock i–VI–III–VII pop pad.
         Root · minor 2nd · tritone · minor 6th flavors (slow morph). */
      var chordDegrees = [
        [1, 1.059, 1.498],
        [0.943, 1.122, 1.682],
        [1.059, 1.414, 1.888],
        [0.89, 1.26, 1.498],
      ];
      var chordStep = 0;
      var chordBarBeats = 0;
      chord1.type = "sine";
      chord2.type = "sine";
      chord3.type = "sine";
      chord1.frequency.value = padRootHz * chordDegrees[0][0];
      chord2.frequency.value = padRootHz * chordDegrees[0][1];
      chord3.frequency.value = padRootHz * chordDegrees[0][2];
      chordFilter.type = "lowpass";
      chordFilter.frequency.value = phoneAudio ? 420 : 340;
      chordFilter.Q.value = 0.45;
      chordGain.gain.value = 0.0001;
      chord1.connect(chordFilter);
      chord2.connect(chordFilter);
      chord3.connect(chordFilter);
      chordFilter.connect(chordGain);
      chordGain.connect(stemBass);

      /* Soft optical breathe — slow sub, not a kick drum. */
      var pulseOsc = c.createOscillator();
      var pulseOsc2 = c.createOscillator();
      var pulseGain = c.createGain();
      var pulseFilter = c.createBiquadFilter();
      var pulseLfo = c.createOscillator();
      var pulseDepth = c.createGain();
      var pulseBaseHz = phoneAudio ? 68 : 50;
      pulseOsc.type = "sine";
      pulseOsc.frequency.value = pulseBaseHz;
      pulseOsc2.type = "sine";
      pulseOsc2.frequency.value = pulseBaseHz + (phoneAudio ? 2.2 : 3.1);
      pulseFilter.type = "lowpass";
      pulseFilter.frequency.value = phoneAudio ? 160 : 120;
      pulseGain.gain.value = 0.0001;
      pulseLfo.type = "sine";
      /* ~52 BPM optical refresh (Faraday breathe). */
      pulseLfo.frequency.value = 52 / 60;
      pulseDepth.gain.value = 0.0001;
      pulseOsc.connect(pulseFilter);
      pulseOsc2.connect(pulseFilter);
      pulseFilter.connect(pulseGain);
      pulseGain.connect(stemPulse);
      stemPulse.connect(bedBus);
      pulseLfo.connect(pulseDepth);
      pulseDepth.connect(pulseGain.gain);

      var filtLfo = c.createOscillator();
      var filtDepth = c.createGain();
      filtLfo.type = "sine";
      filtLfo.frequency.value = 52 / 60;
      filtDepth.gain.value = 0;
      filtLfo.connect(filtDepth);
      filtDepth.connect(filter.frequency);

      /* Soft phosphor veil — mid glass only (never ultrasonic). */
      var shim = c.createOscillator();
      var shimMod = c.createOscillator();
      var shimModG = c.createGain();
      var shimGain = c.createGain();
      var shimBp = c.createBiquadFilter();
      var shimDelay = c.createDelay(0.03);
      var shimDelGain = c.createGain();
      var shimMerge = c.createChannelMerger(2);
      shim.type = "sine";
      shimMod.type = "sine";
      shim.frequency.value = phoneAudio ? 392 : 440;
      shimMod.frequency.value = 0.11;
      shimModG.gain.value = phoneAudio ? 6 : 9;
      shimBp.type = "bandpass";
      shimBp.frequency.value = phoneAudio ? 620 : 700;
      shimBp.Q.value = 1.4;
      shimGain.gain.value = 0.0012;
      shimDelay.delayTime.value = phoneAudio ? 0.014 : 0.022;
      shimDelGain.gain.value = 0.7;
      shimMod.connect(shimModG);
      shimModG.connect(shim.frequency);
      shim.connect(shimBp);
      shimBp.connect(shimGain);
      shimGain.connect(shimMerge, 0, 0);
      shimGain.connect(shimDelay);
      shimDelay.connect(shimDelGain);
      shimDelGain.connect(shimMerge, 0, 1);
      shimMerge.connect(stemShim);
      stemShim.connect(bedBus);

      /* Cathode / VHS air — dark mid hush only (no 3–7 kHz pierce). */
      var hissSrc = c.createBufferSource();
      hissSrc.buffer = pinkBuffer(c);
      hissSrc.loop = true;
      var hissHp = c.createBiquadFilter();
      hissHp.type = "highpass";
      hissHp.frequency.value = 280;
      var hissBp = c.createBiquadFilter();
      hissBp.type = "bandpass";
      hissBp.frequency.value = phoneAudio ? 900 : 780;
      hissBp.Q.value = 0.55;
      var hissLp = c.createBiquadFilter();
      hissLp.type = "lowpass";
      hissLp.frequency.value = 2400;
      var hissGain = c.createGain();
      var hissLfo = c.createOscillator();
      var hissLfoGain = c.createGain();
      hissGain.gain.value = 0;
      hissLfo.type = "sine";
      hissLfo.frequency.value = 0.07;
      hissLfoGain.gain.value = phoneAudio ? 0.0016 : 0.0012;
      hissSrc.connect(hissHp);
      hissHp.connect(hissBp);
      hissBp.connect(hissLp);
      hissLp.connect(hissGain);
      hissLfo.connect(hissLfoGain);
      hissLfoGain.connect(hissGain.gain);
      hissGain.connect(stemHiss);
      stemHiss.connect(bedBus);

      /* Ultrasonic cathode whine REMOVED (hurt ears ~6.8–7.5 kHz). Stub kept muted. */
      var whineGain = c.createGain();
      whineGain.gain.value = 0;

      /* Cinematic texture stem — dark noise + flecks + hull thuds → bedBus group. */
      var texSrc = c.createBufferSource();
      texSrc.buffer = pinkBuffer(c);
      texSrc.loop = true;
      var texHp = c.createBiquadFilter();
      texHp.type = "highpass";
      texHp.frequency.value = 180;
      var texBp = c.createBiquadFilter();
      texBp.type = "bandpass";
      texBp.frequency.value = phoneAudio ? 900 : 700;
      texBp.Q.value = 0.55;
      var texLp = c.createBiquadFilter();
      texLp.type = "lowpass";
      texLp.frequency.value = 2400;
      var texGain = c.createGain();
      texGain.gain.value = 0;
      texSrc.connect(texHp);
      texHp.connect(texBp);
      texBp.connect(texLp);
      texLp.connect(texGain);
      texGain.connect(stemTex);

      /* —— Cinematic landscape stem (deep layers; never a drum grid) —— */
      var stemCine = c.createGain();
      stemCine.gain.value = 1;
      stemCine.connect(bedBus);

      /* Abyss — infrasonic pressure under Faraday glass. */
      var abyss = c.createOscillator();
      var abyssGain = c.createGain();
      var abyssLfo = c.createOscillator();
      var abyssDepth = c.createGain();
      var abyssLp = c.createBiquadFilter();
      abyss.type = "sine";
      abyss.frequency.value = phoneAudio ? 32 : 24;
      abyssLp.type = "lowpass";
      abyssLp.frequency.value = phoneAudio ? 78 : 58;
      abyssGain.gain.value = 0;
      abyssLfo.type = "sine";
      abyssLfo.frequency.value = 0.011;
      abyssDepth.gain.value = phoneAudio ? 0.007 : 0.011;
      abyss.connect(abyssLp);
      abyssLp.connect(abyssGain);
      abyssLfo.connect(abyssDepth);
      abyssDepth.connect(abyssGain.gain);
      abyssGain.connect(stemCine);

      /* Landscape pad — dark filtered saws (cello / hull weather). */
      var land1 = c.createOscillator();
      var land2 = c.createOscillator();
      var landFilter = c.createBiquadFilter();
      var landGain = c.createGain();
      var landDelay = c.createDelay(0.04);
      var landDelG = c.createGain();
      var landMerge = c.createChannelMerger(2);
      land1.type = "sawtooth";
      land2.type = "triangle";
      land1.frequency.value = padRootHz * 0.5;
      land2.frequency.value = padRootHz * 0.5 * 1.498; /* fifth */
      landFilter.type = "lowpass";
      landFilter.frequency.value = phoneAudio ? 150 : 120;
      landFilter.Q.value = 0.35;
      landGain.gain.value = 0;
      landDelay.delayTime.value = phoneAudio ? 0.018 : 0.026;
      landDelG.gain.value = 0.65;
      /* Slow FM + detune drift — landscape morph, not static pad. */
      var landFm = c.createOscillator();
      var landFmG = c.createGain();
      var landDrift = c.createOscillator();
      var landDriftG = c.createGain();
      landFm.type = "sine";
      landFm.frequency.value = 0.035;
      landFmG.gain.value = phoneAudio ? 1.6 : 2.4;
      landDrift.type = "sine";
      landDrift.frequency.value = 0.012;
      landDriftG.gain.value = phoneAudio ? 0.8 : 1.3;
      landFm.connect(landFmG);
      landFmG.connect(land1.frequency);
      landDrift.connect(landDriftG);
      landDriftG.connect(land2.frequency);
      land1.connect(landFilter);
      land2.connect(landFilter);
      landFilter.connect(landGain);
      landGain.connect(landMerge, 0, 0);
      landGain.connect(landDelay);
      landDelay.connect(landDelG);
      landDelG.connect(landMerge, 0, 1);
      landMerge.connect(stemCine);

      /* Distant fifth drone — slow horizon tone. */
      var horizon = c.createOscillator();
      var horizonGain = c.createGain();
      var horizonLfo = c.createOscillator();
      var horizonDepth = c.createGain();
      horizon.type = "sine";
      horizon.frequency.value = padRootHz * 1.5;
      horizonGain.gain.value = 0;
      horizonLfo.type = "sine";
      horizonLfo.frequency.value = 0.027;
      horizonDepth.gain.value = phoneAudio ? 0.002 : 0.003;
      horizon.connect(horizonGain);
      horizonLfo.connect(horizonDepth);
      horizonDepth.connect(horizonGain.gain);
      horizonGain.connect(stemCine);

      /* Hull wind — bandpassed air, landscape weather. */
      var windSrc = c.createBufferSource();
      windSrc.buffer = pinkBuffer(c);
      windSrc.loop = true;
      var windBp = c.createBiquadFilter();
      windBp.type = "bandpass";
      windBp.frequency.value = phoneAudio ? 420 : 320;
      windBp.Q.value = 0.55;
      var windLp = c.createBiquadFilter();
      windLp.type = "lowpass";
      windLp.frequency.value = 900;
      var windGain = c.createGain();
      var windLfo = c.createOscillator();
      var windLfoG = c.createGain();
      windGain.gain.value = 0;
      windLfo.type = "sine";
      windLfo.frequency.value = 0.04;
      windLfoG.gain.value = phoneAudio ? 0.0018 : 0.0014;
      windSrc.connect(windBp);
      windBp.connect(windLp);
      windLp.connect(windGain);
      windLfo.connect(windLfoG);
      windLfoG.connect(windGain.gain);
      windGain.connect(stemCine);

      /* Soft glass veil — mid only (was piercing 1.5–2.6 kHz triangles). */
      var ice = c.createOscillator();
      var iceBp = c.createBiquadFilter();
      var iceGain = c.createGain();
      var iceLfo = c.createOscillator();
      var iceDepth = c.createGain();
      var iceFm = c.createOscillator();
      var iceFmG = c.createGain();
      ice.type = "sine";
      ice.frequency.value = phoneAudio ? 392 : 440;
      iceBp.type = "bandpass";
      iceBp.frequency.value = phoneAudio ? 560 : 620;
      iceBp.Q.value = 1.3;
      iceGain.gain.value = 0;
      iceLfo.type = "sine";
      iceLfo.frequency.value = 0.05;
      iceDepth.gain.value = phoneAudio ? 0.0007 : 0.001;
      iceFm.type = "sine";
      iceFm.frequency.value = 0.13;
      iceFmG.gain.value = phoneAudio ? 4 : 7;
      iceFm.connect(iceFmG);
      iceFmG.connect(ice.frequency);
      ice.connect(iceBp);
      iceBp.connect(iceGain);
      iceLfo.connect(iceDepth);
      iceDepth.connect(iceGain.gain);
      iceGain.connect(stemCine);

      /* —— Lustmord-method deepen: twin abyss · bowed drone · low gong partials · metal hush —— */
      var abyss2 = c.createOscillator();
      var abyss2Gain = c.createGain();
      var abyss2Lp = c.createBiquadFilter();
      var abyss2Lfo = c.createOscillator();
      var abyss2Depth = c.createGain();
      abyss2.type = "sine";
      abyss2.frequency.value = phoneAudio ? 37.4 : 27.2;
      abyss2Lp.type = "lowpass";
      abyss2Lp.frequency.value = phoneAudio ? 70 : 52;
      abyss2Gain.gain.value = 0;
      abyss2Lfo.type = "sine";
      abyss2Lfo.frequency.value = 0.008;
      abyss2Depth.gain.value = phoneAudio ? 0.005 : 0.008;
      abyss2.connect(abyss2Lp);
      abyss2Lp.connect(abyss2Gain);
      abyss2Lfo.connect(abyss2Depth);
      abyss2Depth.connect(abyss2Gain.gain);
      abyss2Gain.connect(stemCine);

      var bow1 = c.createOscillator();
      var bow2 = c.createOscillator();
      var bowFilter = c.createBiquadFilter();
      var bowGain = c.createGain();
      var bowLfo = c.createOscillator();
      var bowDepth = c.createGain();
      bow1.type = "sawtooth";
      bow2.type = "triangle";
      bow1.frequency.value = padRootHz * 0.25;
      bow2.frequency.value = padRootHz * 0.25 * 1.005;
      bowFilter.type = "lowpass";
      bowFilter.frequency.value = phoneAudio ? 110 : 90;
      bowFilter.Q.value = 0.3;
      bowGain.gain.value = 0;
      bowLfo.type = "sine";
      bowLfo.frequency.value = 0.014;
      bowDepth.gain.value = phoneAudio ? 0.002 : 0.0035;
      bow1.connect(bowFilter);
      bow2.connect(bowFilter);
      bowFilter.connect(bowGain);
      bowLfo.connect(bowDepth);
      bowDepth.connect(bowGain.gain);
      bowGain.connect(stemCine);

      var gong = c.createOscillator();
      var gong2 = c.createOscillator();
      var gongBp = c.createBiquadFilter();
      var gongGain = c.createGain();
      gong.type = "sine";
      gong2.type = "sine";
      gong.frequency.value = phoneAudio ? 98 : 82;
      gong2.frequency.value = phoneAudio ? 147 : 123;
      gongBp.type = "lowpass";
      gongBp.frequency.value = phoneAudio ? 280 : 220;
      gongGain.gain.value = 0.0001;
      gong.connect(gongBp);
      gong2.connect(gongBp);
      gongBp.connect(gongGain);
      gongGain.connect(stemCine);
      var gongVerbSend = c.createGain();
      gongVerbSend.gain.value = phoneAudio ? 0.95 : 1.2;
      if (bedGroup && bedGroup.verb) {
        gongGain.connect(gongVerbSend);
        if (bedGroup.verbPreDelay) gongVerbSend.connect(bedGroup.verbPreDelay);
        else gongVerbSend.connect(bedGroup.verb);
      }

      var metalSrc = c.createBufferSource();
      metalSrc.buffer = pinkBuffer(c);
      metalSrc.loop = true;
      var metalBp = c.createBiquadFilter();
      metalBp.type = "bandpass";
      metalBp.frequency.value = phoneAudio ? 280 : 210;
      metalBp.Q.value = 0.45;
      var metalLp = c.createBiquadFilter();
      metalLp.type = "lowpass";
      metalLp.frequency.value = 700;
      var metalGain = c.createGain();
      var metalLfo = c.createOscillator();
      var metalLfoG = c.createGain();
      metalGain.gain.value = 0;
      metalLfo.type = "sine";
      metalLfo.frequency.value = 0.022;
      metalLfoG.gain.value = phoneAudio ? 0.0012 : 0.001;
      metalSrc.connect(metalBp);
      metalBp.connect(metalLp);
      metalLp.connect(metalGain);
      metalLfo.connect(metalLfoG);
      metalLfoG.connect(metalGain.gain);
      metalGain.connect(stemCine);

      /* —— Low subterranean horn body (support under ritual cry — not the identity) ——
         Detuned saw/tri → narrow low formants → soft sat. Phone barely hears this alone. */
      var stemHorn = c.createGain();
      stemHorn.gain.value = 1;
      stemHorn.connect(bedBus);
      var hornBus = c.createGain();
      hornBus.gain.value = 1;
      var hornSatIn = c.createGain();
      hornSatIn.gain.value = 0.85;
      var hornShaper = c.createWaveShaper();
      hornShaper.curve = makeColdSatCurve(2.8);
      hornShaper.oversample = "2x";
      var hornLp = c.createBiquadFilter();
      hornLp.type = "lowpass";
      hornLp.frequency.value = phoneAudio ? 520 : 480;
      hornLp.Q.value = 0.45;
      var hornGain = c.createGain();
      hornGain.gain.value = 0;
      hornBus.connect(hornSatIn);
      hornSatIn.connect(hornShaper);
      hornShaper.connect(hornLp);
      hornLp.connect(hornGain);
      hornGain.connect(stemHorn);
      var hornVerbSend = c.createGain();
      hornVerbSend.gain.value = phoneAudio ? 0.55 : 0.7;
      if (bedGroup && bedGroup.verb) {
        hornGain.connect(hornVerbSend);
        hornVerbSend.connect(bedGroup.verb);
      }

      function makeHornVoice(fundHz, bpHz, voiceGain, detuneCents, bus, q) {
        var saw = c.createOscillator();
        var tri = c.createOscillator();
        var bp = c.createBiquadFilter();
        var vg = c.createGain();
        var det = Math.pow(2, (detuneCents || 0) / 1200);
        saw.type = "sawtooth";
        tri.type = "triangle";
        saw.frequency.value = fundHz;
        tri.frequency.value = fundHz * det;
        bp.type = "bandpass";
        bp.frequency.value = bpHz;
        bp.Q.value = q != null ? q : phoneAudio ? 2.4 : 2.8;
        vg.gain.value = voiceGain;
        saw.connect(bp);
        tri.connect(bp);
        bp.connect(vg);
        vg.connect(bus);
        return { saw: saw, tri: tri, bp: bp, gain: vg };
      }

      var hv1 = makeHornVoice(phoneAudio ? 73 : 65.4, phoneAudio ? 155 : 138, 0.55, 7, hornBus);
      var hv2 = makeHornVoice(phoneAudio ? 82 : 73.4, phoneAudio ? 185 : 168, 0.48, -5, hornBus);
      var hv3 = makeHornVoice(phoneAudio ? 98 : 87.3, phoneAudio ? 220 : 198, 0.4, 11, hornBus);
      var hv4 = makeHornVoice(phoneAudio ? 110 : 98, phoneAudio ? 245 : 225, 0.28, -9, hornBus);
      var hv5 = makeHornVoice(phoneAudio ? 146 : 130.8, phoneAudio ? 265 : 248, 0.18, 6, hornBus);
      var hornVoices = [hv1, hv2, hv3, hv4, hv5];

      var hornFm = c.createOscillator();
      var hornFmG = c.createGain();
      hornFm.type = "sine";
      hornFm.frequency.value = 0.037;
      hornFmG.gain.value = phoneAudio ? 2.2 : 3.4;
      hornFm.connect(hornFmG);
      hornFmG.connect(hv1.saw.frequency);

      /* Support body only — ritual cry owns the signature. Desktop keeps low rumble. */
      var hornPeak = opticsLo ? 0.04 : phoneAudio ? 0.045 : 0.065;
      var hornBreath = c.createOscillator();
      var hornBreathG = c.createGain();
      hornBreath.type = "sine";
      hornBreath.frequency.value = 0.012;
      hornBreathG.gain.value = 0.12;
      hornBus.gain.setValueAtTime(1, c.currentTime);
      hornBreath.connect(hornBreathG);
      hornBreathG.connect(hornBus.gain);

      var hornFiltLfo = c.createOscillator();
      var hornFiltDepth = c.createGain();
      hornFiltLfo.type = "sine";
      hornFiltLfo.frequency.value = 0.014;
      hornFiltDepth.gain.value = phoneAudio ? 28 : 36;
      hornFiltLfo.connect(hornFiltDepth);
      hornVoices.forEach(function (hv) {
        hornFiltDepth.connect(hv.bp.frequency);
      });

      var hornAirSrc = c.createBufferSource();
      hornAirSrc.buffer = pinkBuffer(c);
      hornAirSrc.loop = true;
      var hornAirBp = c.createBiquadFilter();
      hornAirBp.type = "bandpass";
      hornAirBp.frequency.value = phoneAudio ? 280 : 220;
      hornAirBp.Q.value = 1.1;
      var hornAirLp = c.createBiquadFilter();
      hornAirLp.type = "lowpass";
      hornAirLp.frequency.value = 400;
      var hornAirGain = c.createGain();
      hornAirGain.gain.value = 0;
      hornAirSrc.connect(hornAirBp);
      hornAirBp.connect(hornAirLp);
      hornAirLp.connect(hornAirGain);
      hornAirGain.connect(hornBus);

      /* —— Mid brass formant choir (phone-audible horn body under cry) —— */
      var stemMidHorn = c.createGain();
      stemMidHorn.gain.value = 1;
      stemMidHorn.connect(bedBus);
      var midHornBus = c.createGain();
      midHornBus.gain.value = 1;
      var midHornSat = c.createWaveShaper();
      midHornSat.curve = makeColdSatCurve(3.2);
      midHornSat.oversample = "2x";
      var midHornLp = c.createBiquadFilter();
      midHornLp.type = "lowpass";
      midHornLp.frequency.value = phoneAudio ? 1400 : 1600;
      midHornLp.Q.value = 0.5;
      var midHornGain = c.createGain();
      midHornGain.gain.value = 0;
      midHornBus.connect(midHornSat);
      midHornSat.connect(midHornLp);
      midHornLp.connect(midHornGain);
      midHornGain.connect(stemMidHorn);
      var midHornVerbSend = c.createGain();
      midHornVerbSend.gain.value = phoneAudio ? 0.85 : 1.05;
      if (bedGroup && bedGroup.verb) {
        midHornGain.connect(midHornVerbSend);
        if (bedGroup.verbPreDelay) midHornVerbSend.connect(bedGroup.verbPreDelay);
        else midHornVerbSend.connect(bedGroup.verb);
      }
      var mh1 = makeHornVoice(phoneAudio ? 220 : 196, phoneAudio ? 480 : 420, 0.5, 5, midHornBus, phoneAudio ? 3.2 : 3.6);
      var mh2 = makeHornVoice(phoneAudio ? 277 : 247, phoneAudio ? 620 : 560, 0.42, -7, midHornBus, phoneAudio ? 3.4 : 3.8);
      var mh3 = makeHornVoice(phoneAudio ? 330 : 294, phoneAudio ? 780 : 720, 0.32, 9, midHornBus, phoneAudio ? 3.6 : 4.0);
      var midHornVoices = [mh1, mh2, mh3];
      var midHornPeak = opticsLo ? 0.022 : phoneAudio ? 0.038 : 0.03;
      var midHornFiltLfo = c.createOscillator();
      var midHornFiltDepth = c.createGain();
      midHornFiltLfo.type = "sine";
      midHornFiltLfo.frequency.value = 0.017;
      midHornFiltDepth.gain.value = phoneAudio ? 40 : 55;
      midHornFiltLfo.connect(midHornFiltDepth);
      midHornVoices.forEach(function (hv) {
        midHornFiltDepth.connect(hv.bp.frequency);
      });

      /* —— RITUAL HORN CRY (Heresy-METHOD signature — DOMINANT bed identity) ——
         Authored WAV body (ritual_cry / ritual_horn) → formant → sat → crypt verb + dark delay.
         WebAudio = thin multiphonic saw/noise thicken only (NO square, NO siren LFO).
         Fear = harmonic wrongness + distance. Sparse cries → long void → sub. */
      var stemRitual = c.createGain();
      stemRitual.gain.value = 1;
      stemRitual.connect(bedBus);
      var ritualBus = c.createGain();
      ritualBus.gain.value = 1;
      var ritualSatIn = c.createGain();
      ritualSatIn.gain.value = 1.05;
      var ritualShaper = c.createWaveShaper();
      ritualShaper.curve = makeColdSatCurve(4.8);
      ritualShaper.oversample = "2x";
      var ritualSafetyLp = c.createBiquadFilter();
      ritualSafetyLp.type = "lowpass";
      ritualSafetyLp.frequency.value = phoneAudio ? 4200 : 4800;
      ritualSafetyLp.Q.value = 0.55;
      var ritualHp = c.createBiquadFilter();
      ritualHp.type = "highpass";
      /* Phone keeps mid body; desktop opens more low horn under scream. */
      ritualHp.frequency.value = phoneAudio ? 280 : 160;
      ritualHp.Q.value = 0.65;
      var ritualGain = c.createGain();
      ritualGain.gain.value = 0;
      ritualBus.connect(ritualSatIn);
      ritualSatIn.connect(ritualShaper);
      ritualShaper.connect(ritualHp);
      ritualHp.connect(ritualSafetyLp);
      ritualSafetyLp.connect(ritualGain);
      ritualGain.connect(stemRitual);
      var ritualVerbSend = c.createGain();
      ritualVerbSend.gain.value = phoneAudio ? 1.4 : 1.75;
      var ritualChamberSend = c.createGain();
      ritualChamberSend.gain.value = phoneAudio ? 0.6 : 0.78;
      if (bedGroup && bedGroup.verb) {
        ritualGain.connect(ritualVerbSend);
        if (bedGroup.verbPreDelay) ritualVerbSend.connect(bedGroup.verbPreDelay);
        else ritualVerbSend.connect(bedGroup.verb);
      }
      if (bedGroup && bedGroup.chamberVerb) {
        ritualGain.connect(ritualChamberSend);
        ritualChamberSend.connect(bedGroup.chamberVerb);
      }
      /* Dark dual-tap optical echo on cry — free cavern, NOT dance grid / alarm cadence. */
      var ritualDelay = c.createDelay(1.5);
      ritualDelay.delayTime.value = phoneAudio ? 0.62 : 0.78;
      var ritualDelay2 = c.createDelay(1.8);
      ritualDelay2.delayTime.value = phoneAudio ? 0.94 : 1.15;
      var ritualDelayHp = c.createBiquadFilter();
      ritualDelayHp.type = "highpass";
      ritualDelayHp.frequency.value = 200;
      var ritualDelayLp = c.createBiquadFilter();
      ritualDelayLp.type = "lowpass";
      ritualDelayLp.frequency.value = phoneAudio ? 1700 : 1950;
      var ritualDelayFb = c.createGain();
      ritualDelayFb.gain.value = phoneAudio ? 0.3 : 0.36;
      var ritualDelayWet = c.createGain();
      ritualDelayWet.gain.value = phoneAudio ? 0.48 : 0.58;
      var ritualDelay2Wet = c.createGain();
      ritualDelay2Wet.gain.value = phoneAudio ? 0.24 : 0.32;
      ritualGain.connect(ritualDelay);
      ritualDelay.connect(ritualDelayHp);
      ritualDelayHp.connect(ritualDelayLp);
      ritualDelayLp.connect(ritualDelayFb);
      ritualDelayFb.connect(ritualDelay);
      ritualDelayLp.connect(ritualDelayWet);
      ritualDelayWet.connect(stemRitual);
      ritualGain.connect(ritualDelay2);
      ritualDelay2.connect(ritualDelay2Wet);
      ritualDelay2Wet.connect(stemRitual);
      /* Tiny wet-only void shimmer on cry echoes (geological, not 80s guitar). */
      var cryVoidAll = c.createBiquadFilter();
      cryVoidAll.type = "allpass";
      cryVoidAll.frequency.value = phoneAudio ? 480 : 580;
      cryVoidAll.Q.value = 0.35;
      var cryVoidLfo = c.createOscillator();
      var cryVoidDepth = c.createGain();
      cryVoidLfo.type = "sine";
      cryVoidLfo.frequency.value = 0.008;
      cryVoidDepth.gain.value = phoneAudio ? 12 : 20;
      cryVoidLfo.connect(cryVoidDepth);
      cryVoidDepth.connect(cryVoidAll.frequency);
      var cryVoidWet = c.createGain();
      cryVoidWet.gain.value = phoneAudio ? 0.07 : 0.09;
      ritualDelayLp.connect(cryVoidAll);
      cryVoidAll.connect(cryVoidWet);
      cryVoidWet.connect(stemRitual);

      /* Shared scream formants — phone mid-readable; desktop darker cavity + low body via HP. */
      var cryFormantA = c.createBiquadFilter();
      cryFormantA.type = "bandpass";
      cryFormantA.frequency.value = phoneAudio ? 1680 : 1480;
      cryFormantA.Q.value = phoneAudio ? 6.8 : 7.8;
      var cryFormantB = c.createBiquadFilter();
      cryFormantB.type = "bandpass";
      cryFormantB.frequency.value = phoneAudio ? 2450 : 2150;
      cryFormantB.Q.value = phoneAudio ? 5.5 : 6.4;
      var cryBodyG = c.createGain();
      cryBodyG.gain.value = 0.42;
      var cryEdgeG = c.createGain();
      cryEdgeG.gain.value = 0.28;
      cryFormantA.connect(cryBodyG);
      cryFormantB.connect(cryEdgeG);
      cryBodyG.connect(ritualBus);
      cryEdgeG.connect(ritualBus);

      /* WAV sample path — own formants into ritualBus (body when buffers load). */
      var ritualSampleIn = c.createGain();
      ritualSampleIn.gain.value = 1;
      var wavFormA = c.createBiquadFilter();
      wavFormA.type = "bandpass";
      wavFormA.frequency.value = phoneAudio ? 1680 : 1480;
      wavFormA.Q.value = phoneAudio ? 5.2 : 5.8;
      var wavFormB = c.createBiquadFilter();
      wavFormB.type = "bandpass";
      wavFormB.frequency.value = phoneAudio ? 2450 : 2150;
      wavFormB.Q.value = phoneAudio ? 4.4 : 5.0;
      var wavBodyG = c.createGain();
      wavBodyG.gain.value = 0.7;
      var wavEdgeG = c.createGain();
      wavEdgeG.gain.value = 0.45;
      ritualSampleIn.connect(wavFormA);
      ritualSampleIn.connect(wavFormB);
      wavFormA.connect(wavBodyG);
      wavFormB.connect(wavEdgeG);
      wavBodyG.connect(ritualBus);
      wavEdgeG.connect(ritualBus);

      /* Thin multiphonic saw cluster (thicken only) — NO square / alarm tone. */
      var cryFund = phoneAudio ? 92 : 74;
      var cryCents = [0, 7, -5, 13, -9];
      var cryRatios = [1, 1.97, 2.91, 3.88, 5.05];
      var cryAmps = [0.4, 0.32, 0.24, 0.16, 0.1];
      var cryVoices = [];
      for (var ci = 0; ci < cryRatios.length; ci++) {
        var co = c.createOscillator();
        var cg = c.createGain();
        var cg2 = c.createGain();
        var baseHz = cryFund * cryRatios[ci] * Math.pow(2, cryCents[ci] / 1200);
        co.type = "sawtooth";
        co.frequency.value = baseHz;
        cg.gain.value = cryAmps[ci];
        cg2.gain.value = cryAmps[ci] * 0.35;
        co.connect(cg);
        co.connect(cg2);
        cg.connect(ci % 2 === 0 ? cryFormantA : cryFormantB);
        cg2.connect(ci % 2 === 0 ? cryFormantB : cryFormantA);
        cryVoices.push({ osc: co, g: cg, g2: cg2, baseHz: baseHz });
      }
      /* Synth thicken muted between cries — WAV owns identity. */
      cryBodyG.gain.value = 0.0001;
      cryEdgeG.gain.value = 0.0001;

      /* Breath/grain through scream formant — organic grit, not beep. */
      var ritualNoiseSrc = c.createBufferSource();
      ritualNoiseSrc.buffer = pinkBuffer(c);
      ritualNoiseSrc.loop = true;
      var ritualNoiseBp = c.createBiquadFilter();
      ritualNoiseBp.type = "bandpass";
      ritualNoiseBp.frequency.value = phoneAudio ? 1720 : 1580;
      ritualNoiseBp.Q.value = phoneAudio ? 4.8 : 5.6;
      var ritualNoiseG = c.createGain();
      ritualNoiseG.gain.value = phoneAudio ? 0.08 : 0.1;
      ritualNoiseSrc.connect(ritualNoiseBp);
      ritualNoiseBp.connect(ritualNoiseG);
      ritualNoiseG.connect(ritualBus);

      /* Geological formant drift ONLY (<0.02 Hz) — tiny cavity shift, NOT siren woo-woo. */
      var cryFormLfo = c.createOscillator();
      var cryFormDepthA = c.createGain();
      var cryFormDepthB = c.createGain();
      cryFormLfo.type = "sine";
      cryFormLfo.frequency.value = 0.013;
      cryFormDepthA.gain.value = phoneAudio ? 35 : 48;
      cryFormDepthB.gain.value = phoneAudio ? 42 : 55;
      cryFormLfo.connect(cryFormDepthA);
      cryFormLfo.connect(cryFormDepthB);
      cryFormDepthA.connect(cryFormantA.frequency);
      cryFormDepthB.connect(cryFormantB.frequency);
      cryFormDepthA.connect(ritualNoiseBp.frequency);

      /* Near-silent underlay between sparse cries (void owns the arrangement). */
      var ritualUnderPeak = opticsLo ? 0.002 : phoneAudio ? 0.0035 : 0.0025;
      var ritualCryPeak = opticsLo ? 0.09 : phoneAudio ? 0.135 : 0.118;

      /* —— Production FX (tasteful under text) —— */
      /* Soft cold drive on landscape only. */
      var landDriveIn = c.createGain();
      landDriveIn.gain.value = 0.9;
      var landShaper = c.createWaveShaper();
      landShaper.curve = makeColdSatCurve(1.6);
      landShaper.oversample = "2x";
      var landDriveLp = c.createBiquadFilter();
      landDriveLp.type = "lowpass";
      landDriveLp.frequency.value = 1400;
      var landDriveWet = c.createGain();
      landDriveWet.gain.value = opticsLo ? 0.08 : 0.14;
      /* Re-route land through drive into stemCine (already connected via landMerge).
         Parallel drive tap from landGain. */
      landGain.connect(landDriveIn);
      landDriveIn.connect(landShaper);
      landShaper.connect(landDriveLp);
      landDriveLp.connect(landDriveWet);
      landDriveWet.connect(stemCine);

      /* Lo-fi bandwidth crush on TEX stem only — not whole mix. */
      var texLofi = c.createWaveShaper();
      texLofi.curve = makeColdSatCurve(3.8);
      texLofi.oversample = "none";
      var texLofiLp = c.createBiquadFilter();
      texLofiLp.type = "lowpass";
      texLofiLp.frequency.value = phoneAudio ? 1600 : 1400;
      var texLofiHp = c.createBiquadFilter();
      texLofiHp.type = "highpass";
      texLofiHp.frequency.value = 120;
      /* Rebuild tex → lofi → stemTex */
      try {
        texGain.disconnect();
      } catch (_) {}
      texGain.connect(texLofiHp);
      texLofiHp.connect(texLofi);
      texLofi.connect(texLofiLp);
      texLofiLp.connect(stemTex);

      /* Optical delay — ~52 BPM dotted / free cavern (~450–900ms), dark feedback.
         Pad almost none; cry/gong own the echo identity. */
      var DELAY_SEC = (60 / 52) * 0.75;
      var optDelay = c.createDelay(2.0);
      optDelay.delayTime.value = Math.min(1.85, Math.max(0.45, DELAY_SEC));
      var delayLp = c.createBiquadFilter();
      delayLp.type = "lowpass";
      delayLp.frequency.value = phoneAudio ? 1400 : 1200;
      var delayHp = c.createBiquadFilter();
      delayHp.type = "highpass";
      delayHp.frequency.value = 180;
      var delayFb = c.createGain();
      delayFb.gain.value = 0.3;
      var delayWet = c.createGain();
      delayWet.gain.value = opticsLo ? 0.06 : phoneAudio ? 0.1 : 0.12;
      var delaySend = c.createGain();
      /* Bed-wide send tiny — pads must not smear the cry. */
      delaySend.gain.value = 0.06;
      var cryEchoSend = c.createGain();
      cryEchoSend.gain.value = phoneAudio ? 0.55 : 0.68;
      var gongEchoSend = c.createGain();
      gongEchoSend.gain.value = phoneAudio ? 0.35 : 0.45;
      var delayLfo = c.createOscillator();
      var delayLfoG = c.createGain();
      delayLfo.type = "sine";
      delayLfo.frequency.value = 0.028;
      delayLfoG.gain.value = 0.018;
      delayLfo.connect(delayLfoG);
      delayLfoG.connect(optDelay.delayTime);
      /* Return into bedMix (never bedBus — avoids regen loop). Each pass through dark LP. */
      if (bedGroup && bedGroup.bedPre && bedGroup.bedMix) {
        bedGroup.bedPre.connect(delaySend);
        delaySend.connect(optDelay);
        ritualGain.connect(cryEchoSend);
        cryEchoSend.connect(optDelay);
        gongGain.connect(gongEchoSend);
        gongEchoSend.connect(optDelay);
        optDelay.connect(delayHp);
        delayHp.connect(delayLp);
        delayLp.connect(delayFb);
        delayFb.connect(optDelay);
        delayLp.connect(delayWet);
        delayWet.connect(bedGroup.bedMix);
      }

    osc1.start();
    osc2.start();
      oscBody.start();
      oscAir.start();
      oscOdd.start();
    lfo.start();
      bassAmLfo.start();
      pulseOsc.start();
      pulseOsc2.start();
      pulseLfo.start();
      filtLfo.start();
      shim.start();
      shimMod.start();
      chord1.start();
      chord2.start();
      chord3.start();
      hissSrc.start();
      hissLfo.start();
      texSrc.start();
      abyss.start();
      abyssLfo.start();
      land1.start();
      land2.start();
      landFm.start();
      landDrift.start();
      horizon.start();
      horizonLfo.start();
      windSrc.start();
      windLfo.start();
      ice.start();
      iceLfo.start();
      iceFm.start();
      abyss2.start();
      abyss2Lfo.start();
      bow1.start();
      bow2.start();
      bowLfo.start();
      gong.start();
      gong2.start();
      metalSrc.start();
      metalLfo.start();
      hornVoices.forEach(function (hv) {
        hv.saw.start();
        hv.tri.start();
      });
      midHornVoices.forEach(function (hv) {
        hv.saw.start();
        hv.tri.start();
      });
      hornAirSrc.start();
      hornBreath.start();
      hornFiltLfo.start();
      hornFm.start();
      midHornFiltLfo.start();
      cryVoices.forEach(function (cv) {
        cv.osc.start();
      });
      ritualNoiseSrc.start();
      cryFormLfo.start();
      cryVoidLfo.start();
      delayLfo.start();
      gain.gain.linearRampToValueAtTime(bedTarget(), c.currentTime + 1.4);
      hissGain.gain.linearRampToValueAtTime(hissTarget(), c.currentTime + 1.8);
      texGain.gain.linearRampToValueAtTime(
        opticsLo ? (phoneAudio ? 0.001 : 0.0007) : phoneAudio ? 0.0016 : 0.0012,
        c.currentTime + 2.0
      );
      /* Sparse: underlay near silence; first cry ~2.5–5s carries identity over sub. */
      ritualGain.gain.setValueAtTime(0.0001, c.currentTime);
      ritualGain.gain.linearRampToValueAtTime(ritualUnderPeak, c.currentTime + 1.8);
      midHornGain.gain.setValueAtTime(0.0001, c.currentTime);
      midHornGain.gain.linearRampToValueAtTime(midHornPeak * 0.55, c.currentTime + 2.4);
      hornGain.gain.setValueAtTime(0.0001, c.currentTime);
      hornGain.gain.linearRampToValueAtTime(hornPeak * 0.7, c.currentTime + 2.6);
      hornAirGain.gain.linearRampToValueAtTime(
        opticsLo ? 0.004 : phoneAudio ? 0.008 : 0.007,
        c.currentTime + 2.8
      );
      abyssGain.gain.linearRampToValueAtTime(
        opticsLo ? (phoneAudio ? 0.045 : 0.04) : phoneAudio ? 0.07 : 0.062,
        c.currentTime + 2.6
      );
      abyss2Gain.gain.linearRampToValueAtTime(
        opticsLo ? (phoneAudio ? 0.028 : 0.022) : phoneAudio ? 0.042 : 0.036,
        c.currentTime + 3.0
      );
      bowGain.gain.linearRampToValueAtTime(
        opticsLo ? (phoneAudio ? 0.005 : 0.004) : phoneAudio ? 0.01 : 0.008,
        c.currentTime + 3.8
      );
      metalGain.gain.linearRampToValueAtTime(
        opticsLo ? (phoneAudio ? 0.0005 : 0.0004) : phoneAudio ? 0.0009 : 0.0008,
        c.currentTime + 3.6
      );
      /* Pad ducked near void — cry → silence → sub; never a wash. */
      landGain.gain.linearRampToValueAtTime(
        opticsLo ? 0.00012 : phoneAudio ? 0.00016 : 0.00014,
        c.currentTime + 3.5
      );
      horizonGain.gain.linearRampToValueAtTime(
        opticsLo ? 0.00006 : phoneAudio ? 0.0001 : 0.00008,
        c.currentTime + 3.5
      );
      windGain.gain.linearRampToValueAtTime(
        opticsLo ? (phoneAudio ? 0.00025 : 0.00018) : phoneAudio ? 0.0004 : 0.0003,
        c.currentTime + 3.0
      );
      iceGain.gain.linearRampToValueAtTime(
        opticsLo ? 0.00006 : phoneAudio ? 0.00008 : 0.00007,
        c.currentTime + 3.2
      );

      /* Faraday optical bed (readers first):
         - ~52 BPM sparse clock — no club kicks/hats/claps
         - stem arrangement + shared optical verb
         - rare glass drop → hush → vacuum
         - white noise kept whisper-thin */
      var BPM = 52;
      var BEAT_MS = 60000 / BPM;

      var nodes = {
        oscs: [
          osc1,
          osc2,
          oscBody,
          oscAir,
          oscOdd,
          lfo,
          bassAmLfo,
          pulseOsc,
          pulseOsc2,
          pulseLfo,
          filtLfo,
          shim,
          shimMod,
          chord1,
          chord2,
          chord3,
          hissLfo,
          abyss,
          abyssLfo,
          abyss2,
          abyss2Lfo,
          bow1,
          bow2,
          bowLfo,
          hornBreath,
          hornFiltLfo,
          hornFm,
          midHornFiltLfo,
          cryFormLfo,
          cryVoidLfo,
          gong,
          gong2,
          metalLfo,
          land1,
          land2,
          landFm,
          landDrift,
          horizon,
          horizonLfo,
          windLfo,
          ice,
          iceLfo,
          iceFm,
          delayLfo,
        ],
        gain: gain,
        hissGain: hissGain,
        hissSrc: hissSrc,
        texSrc: texSrc,
        texGain: texGain,
        pulseGain: pulseGain,
        pulseDepth: pulseDepth,
        pulseLfo: pulseLfo,
        filtLfo: filtLfo,
        filtDepth: filtDepth,
        bassAmDepth: bassAmDepth,
        shimGain: shimGain,
        chordGain: chordGain,
        chordOscs: [chord1, chord2, chord3],
        padRootHz: padRootHz,
        chordStep: 0,
        chordBarBeats: 0,
        nextRootShiftAt: Date.now() + 180000 + Math.random() * 120000,
        whineGain: whineGain,
        stemBass: stemBass,
        stemHiss: stemHiss,
        stemPulse: stemPulse,
        stemShim: stemShim,
        stemTex: stemTex,
        stemCine: stemCine,
        abyssGain: abyssGain,
        abyss2Gain: abyss2Gain,
        bowGain: bowGain,
        hornGain: hornGain,
        hornPeak: hornPeak,
        hornAirSrc: hornAirSrc,
        hornAirGain: hornAirGain,
        midHornGain: midHornGain,
        midHornPeak: midHornPeak,
        ritualGain: ritualGain,
        ritualUnderPeak: ritualUnderPeak,
        ritualCryPeak: ritualCryPeak,
        ritualNoiseSrc: ritualNoiseSrc,
        ritualSampleIn: ritualSampleIn,
        cryVoices: cryVoices,
        cryBodyG: cryBodyG,
        cryEdgeG: cryEdgeG,
        cryFormantA: cryFormantA,
        cryFormantB: cryFormantB,
        wavFormA: wavFormA,
        wavFormB: wavFormB,
        cryEchoSend: cryEchoSend,
        gongGain: gongGain,
        metalGain: metalGain,
        landGain: landGain,
        land1: land1,
        land2: land2,
        landDriveWet: landDriveWet,
        landFilter: landFilter,
        horizon: horizon,
        horizonGain: horizonGain,
        windSrc: windSrc,
        windGain: windGain,
        metalSrc: metalSrc,
        iceGain: iceGain,
        delayWet: delayWet,
        delaySend: delaySend,
        delayFb: delayFb,
        delayLp: delayLp,
        filter: filter,
        crackleTimer: null,
        atmTimer: null,
        pulseTimer: null,
        dropTimer: null,
        dropEndTimer: null,
        dropTaperTimer: null,
        hushWatchTimer: null,
        vacuumTimer: null,
        cryTimer: null,
        cryCount: 0,
        bedStartedAt: Date.now(),
        dropDueAt: 0,
        mode: "ambient",
        priorMode: "ambient",
        inDrop: false,
        inHush: false,
        inVacuum: false,
        inTaper: false,
        beat: 0,
        readFocus: !!readFocus,
        stems: { bass: 1, hiss: 1, pulse: 0, shim: 0.35, tex: 0.85, kick: false, pump: false },
      };
      hornVoices.forEach(function (hv) {
        nodes.oscs.push(hv.saw, hv.tri);
      });
      midHornVoices.forEach(function (hv) {
        nodes.oscs.push(hv.saw, hv.tri);
      });
      cryVoices.forEach(function (cv) {
        nodes.oscs.push(cv.osc);
      });

      function chordTarget(mode) {
        /* Soft pad near silence — ritual cry owns identity. */
        if (opticsLo) return mode === "drop" ? 0.0007 : 0.00045;
        if (phoneAudio) return mode === "drop" ? 0.00085 : 0.00055;
        return mode === "drop" ? 0.00075 : 0.0005;
      }

      function landTarget(mode) {
        /* Subtract pad wash — cry → void → sub. Mood can thin further. */
        var mul = (moodOf().land != null ? moodOf().land : 1) * 0.35;
        if (opticsLo) return (mode === "drop" ? 0.00025 : 0.00015) * mul;
        if (phoneAudio) return (mode === "drop" ? 0.0003 : 0.00018) * mul;
        return (mode === "drop" ? 0.00028 : 0.00016) * mul;
      }

      function abyssTarget(mode) {
        if (opticsLo) return mode === "vacuum" || mode === "hush" ? 0.006 : 0.01;
        if (phoneAudio) return mode === "vacuum" || mode === "hush" ? 0.012 : mode === "bloom" ? 0.024 : 0.02;
        return mode === "vacuum" || mode === "hush" ? 0.01 : mode === "bloom" ? 0.022 : 0.018;
      }

      function windTarget(mode) {
        if (opticsLo) return mode === "bloom" ? 0.0024 : mode === "hush" ? 0.001 : 0.0016;
        if (phoneAudio) return mode === "bloom" ? 0.0045 : mode === "hush" ? 0.002 : 0.0035;
        return mode === "bloom" ? 0.004 : mode === "hush" ? 0.0016 : 0.0028;
      }

      function iceTarget(mode) {
        /* Soft mid veil only — never piercing. */
        if (opticsLo) return mode === "bloom" ? 0.0007 : mode === "drop" ? 0.0008 : 0.00045;
        if (phoneAudio) return mode === "bloom" ? 0.001 : mode === "drop" ? 0.0011 : 0.0008;
        return mode === "bloom" ? 0.0012 : mode === "drop" ? 0.0013 : 0.00095;
      }

      function texStemTarget(mode) {
        if (opticsLo) return mode === "drop" ? 1.05 : mode === "bloom" ? 0.95 : mode === "pulse" ? 0.8 : 0.7;
        return mode === "drop" ? 1.15 : mode === "bloom" ? 1 : mode === "pulse" ? 0.85 : 0.75;
      }

      function texNoiseTarget(mode) {
        /* Continuous tex bed stays whisper — rhythmic hits use tex_hit.wav. */
        if (opticsLo) return mode === "drop" ? 0.002 : mode === "bloom" ? 0.0016 : 0.0012;
        if (phoneAudio) return mode === "drop" ? 0.0035 : mode === "bloom" ? 0.0028 : 0.002;
        return mode === "drop" ? 0.003 : mode === "bloom" ? 0.0024 : 0.0016;
      }

      function amDepthFor(mode) {
        if (mode === "drop") return opticsLo ? 0.1 : 0.14;
        if (mode === "pulse") return opticsLo ? 0.08 : 0.12;
        if (mode === "bloom") return opticsLo ? 0.06 : 0.09;
        return opticsLo ? 0.03 : 0.05;
      }

      function rampStem(g, v, sec) {
        try {
          var t = c.currentTime;
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
          g.gain.linearRampToValueAtTime(Math.max(0.0001, v), t + (sec || 2.2));
        } catch (_) {}
      }

      function rampCine(mode, sec) {
        var t = c.currentTime;
        var s = sec || 2.4;
        try {
          if (abyssGain) {
            abyssGain.gain.cancelScheduledValues(t);
            abyssGain.gain.linearRampToValueAtTime(abyssTarget(mode), t + s);
          }
          if (landGain) {
            landGain.gain.cancelScheduledValues(t);
            landGain.gain.linearRampToValueAtTime(
              mode === "hush" || mode === "vacuum" ? landTarget(mode) * 0.35 : landTarget(mode),
              t + s
            );
          }
          if (horizonGain) {
            horizonGain.gain.cancelScheduledValues(t);
            horizonGain.gain.linearRampToValueAtTime(
              mode === "bloom" ? (opticsLo ? 0.002 : 0.0025) : mode === "hush" || mode === "vacuum" ? 0.0006 : opticsLo ? 0.0012 : 0.0018,
              t + s
            );
          }
          if (windGain) {
            windGain.gain.cancelScheduledValues(t);
            windGain.gain.linearRampToValueAtTime(windTarget(mode), t + s);
          }
          if (iceGain) {
            iceGain.gain.cancelScheduledValues(t);
            iceGain.gain.linearRampToValueAtTime(
              mode === "hush" || mode === "vacuum" ? iceTarget(mode) * 0.4 : iceTarget(mode),
              t + s
            );
          }
          if (stemCine) {
            rampStem(
              stemCine,
              mode === "vacuum" ? 0.65 : mode === "hush" ? 0.75 : mode === "bloom" ? 1.1 : 1,
              s
            );
          }
          if (landFilter && (mode === "bloom" || mode === "ambient")) {
            landFilter.frequency.cancelScheduledValues(t);
            landFilter.frequency.linearRampToValueAtTime(
              mode === "bloom" ? (phoneAudio ? 280 : 240) : phoneAudio ? 220 : 180,
              t + s
            );
          }
        } catch (_) {}
      }

      function sidechainPump(opts) {
        /* Gentle optical duck — pad/air yield to breathe; never club pumping. */
        opts = opts || {};
        var t0 = c.currentTime;
        var airDepth = opts.airDepth != null ? opts.airDepth : opticsLo ? 0.72 : 0.68;
        var bassDepth = opts.bassDepth != null ? opts.bassDepth : opticsLo ? 0.78 : 0.74;
        var bassMs = opts.bassMs != null ? opts.bassMs : 0.42;
        var airMs = opts.airMs != null ? opts.airMs : 0.55;
        try {
          if (!opts.bassOnly) {
            [stemHiss, stemShim, stemTex, stemCine].forEach(function (st) {
              if (!st) return;
              var cur = Math.max(0.0001, st.gain.value);
              st.gain.cancelScheduledValues(t0);
              st.gain.setValueAtTime(cur, t0);
              st.gain.linearRampToValueAtTime(cur * airDepth, t0 + 0.045);
              st.gain.linearRampToValueAtTime(cur, t0 + airMs);
            });
          }
          var bCur = Math.max(0.0001, stemBass.gain.value);
          stemBass.gain.cancelScheduledValues(t0);
          stemBass.gain.setValueAtTime(bCur, t0);
          stemBass.gain.linearRampToValueAtTime(bCur * bassDepth, t0 + 0.04);
          stemBass.gain.linearRampToValueAtTime(bCur, t0 + bassMs);
          if (chordGain) {
            var cCur = Math.max(0.0001, chordGain.gain.value);
            chordGain.gain.cancelScheduledValues(t0);
            chordGain.gain.setValueAtTime(cCur, t0);
            chordGain.gain.linearRampToValueAtTime(cCur * Math.max(0.62, bassDepth - 0.04), t0 + 0.05);
            chordGain.gain.linearRampToValueAtTime(cCur, t0 + bassMs + 0.08);
          }
          if (opts.bassOnly) {
            [stemHiss, stemShim, stemTex, stemCine].forEach(function (st) {
              if (!st) return;
              var aCur = Math.max(0.0001, st.gain.value);
              st.gain.cancelScheduledValues(t0);
              st.gain.setValueAtTime(aCur, t0);
              st.gain.linearRampToValueAtTime(aCur * (airDepth + 0.06), t0 + 0.05);
              st.gain.linearRampToValueAtTime(aCur, t0 + airMs);
            });
          }
        } catch (_) {}
      }

      function applyChordStep() {
        var deg = chordDegrees[chordStep % chordDegrees.length];
        var root = nodes.padRootHz || padRootHz;
        var t = c.currentTime;
        try {
          chord1.frequency.cancelScheduledValues(t);
          chord2.frequency.cancelScheduledValues(t);
          chord3.frequency.cancelScheduledValues(t);
          chord1.frequency.linearRampToValueAtTime(root * deg[0], t + 0.35);
          chord2.frequency.linearRampToValueAtTime(root * deg[1], t + 0.4);
          chord3.frequency.linearRampToValueAtTime(root * deg[2], t + 0.45);
          if (nodes.land1 && nodes.land2) {
            nodes.land1.frequency.cancelScheduledValues(t);
            nodes.land2.frequency.cancelScheduledValues(t);
            nodes.land1.frequency.linearRampToValueAtTime(root * deg[0] * 0.5, t + 0.9);
            nodes.land2.frequency.linearRampToValueAtTime(root * deg[0] * 0.5 * 1.498, t + 1.05);
          }
          if (nodes.horizon) {
            nodes.horizon.frequency.cancelScheduledValues(t);
            nodes.horizon.frequency.linearRampToValueAtTime(root * 1.5, t + 1.2);
          }
        } catch (_) {}
      }

      function advanceChordProgression() {
        if (!humNodes || humNodes !== nodes || nodes.inHush || nodes.inVacuum) return;
        /* Geology-time — chord morph every ~64 beats (~72s @ 52 BPM). No tourism. */
        chordBarBeats += 1;
        nodes.chordBarBeats = chordBarBeats;
        if (chordBarBeats < 64) return;
        chordBarBeats = 0;
        nodes.chordBarBeats = 0;
        chordStep = (chordStep + 1) % chordDegrees.length;
        nodes.chordStep = chordStep;
        if (Date.now() >= nodes.nextRootShiftAt) {
          var shift = Math.random() < 0.5 ? -1 : 1;
          nodes.padRootHz = Math.max(78, Math.min(98, (nodes.padRootHz || padRootHz) * Math.pow(2, shift / 12)));
          nodes.nextRootShiftAt = Date.now() + 180000 + Math.random() * 120000;
        }
        applyChordStep();
      }

      function softHat() {
        /* Hat sample not in Faraday pack — never synthesize 9–10 kHz ticks. */
        return;
      }

      /* Rare reverse-envelope grain swell (optical inhale). */
      function reverseSwell() {
        if (!humNodes || humNodes !== nodes || muted || reduce) return;
        if (nodes.readFocus || nodes.inHush || nodes.inVacuum) return;
        var t0 = c.currentTime;
        var src = c.createBufferSource();
        src.buffer = pinkBuffer(c);
        var bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = phoneAudio ? 480 : 380;
        bp.Q.value = 0.8;
        var lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 1200;
        var g = c.createGain();
        g.gain.value = 0.0001;
        src.connect(bp);
        bp.connect(lp);
        lp.connect(g);
        g.connect(stemCine);
        var peak = opticsLo ? 0.006 : phoneAudio ? 0.01 : 0.012;
        var dur = 1.1 + Math.random() * 0.7;
        g.gain.exponentialRampToValueAtTime(peak, t0 + dur * 0.85);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.start(t0);
        src.stop(t0 + dur + 0.05);
      }

      function softClap() {
        /* Forbidden — club pack never product rhythm. */
        return;
      }

      function softRide() {
        return;
      }

      function ritualGong() {
        if (!humNodes || humNodes !== nodes || muted || reduce) return;
        if (nodes.readFocus || nodes.inHush || nodes.inVacuum) return;
        var t0 = c.currentTime;
        var peak = opticsLo ? 0.012 : phoneAudio ? 0.018 : 0.022;
        try {
          gongGain.gain.cancelScheduledValues(t0);
          gongGain.gain.setValueAtTime(Math.max(0.0001, gongGain.gain.value), t0);
          gongGain.gain.linearRampToValueAtTime(peak, t0 + 0.08);
          gongGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.8);
        } catch (_) {}
      }

      function dropRim() {
        if (!humNodes || humNodes !== nodes || muted || reduce || !nodes.inDrop) return;
        /* Soft glass tick — not a snare. */
        playSample(c, "rim", stemPulse, opticsLo ? 0.1 : 0.15);
      }

      function metalFleck() {
        if (!humNodes || humNodes !== nodes || muted || reduce) return;
        var peak = (opticsLo ? 0.08 : 0.12) * (nodes.inDrop ? 1.1 : 1);
        if (playSample(c, "tex_hit", stemTex, peak)) return;
      }

      function hullThud() {
        if (!humNodes || humNodes !== nodes || muted || reduce) return;
        var t0 = c.currentTime;
    var o = c.createOscillator();
        var ng = c.createGain();
        var f = c.createBiquadFilter();
        o.type = "sine";
        o.frequency.setValueAtTime(48, t0);
        o.frequency.exponentialRampToValueAtTime(28, t0 + 0.4);
        f.type = "lowpass";
        f.frequency.value = 120;
        ng.gain.value = 0;
        o.connect(f);
        f.connect(ng);
        ng.connect(stemTex);
        var peak = opticsLo ? 0.01 : 0.016;
        ng.gain.linearRampToValueAtTime(peak, t0 + 0.02);
        ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
        o.start(t0);
        o.stop(t0 + 0.6);
        var src = c.createBufferSource();
        src.buffer = noiseBuffer(c);
        var bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 400;
        bp.Q.value = 1.2;
    var g = c.createGain();
    g.gain.value = 0;
        src.connect(bp);
        bp.connect(g);
        g.connect(stemTex);
        g.gain.linearRampToValueAtTime(peak * 0.45, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        src.start(t0);
        src.stop(t0 + 0.4);
      }

      function softDrumHit() {
        /* Faraday pack = rim/tex_hit/stab only. Kick never loaded; never synth a club hit. */
        return;
      }

      function coldSatTick() {
        if (!humNodes || humNodes !== nodes || muted || reduce) return;
        var t0 = c.currentTime;
        var burst = c.createBufferSource();
        burst.buffer = noiseBuffer(c);
        var bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1400 + Math.random() * 500;
        bp.Q.value = 1.6;
        var g = c.createGain();
        g.gain.value = 0;
        burst.connect(bp);
        bp.connect(g);
        g.connect(stemTex);
        var peak = opticsLo ? 0.014 : 0.022;
        if (nodes.mode === "bloom") peak *= 1.4;
        if (nodes.inDrop) peak *= 1.55;
        g.gain.linearRampToValueAtTime(peak, t0 + 0.001);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
        burst.start(t0);
        burst.stop(t0 + 0.04);
        /* Brief sat bloom on the group. */
        if (bedGroup && bedGroup.satWet) {
          try {
            var sat = bedGroup.satWet;
            var cur = sat.gain.value;
            sat.gain.cancelScheduledValues(t0);
            sat.gain.setValueAtTime(cur, t0);
            sat.gain.linearRampToValueAtTime(Math.min(0.52, cur + (nodes.inDrop ? 0.18 : 0.12)), t0 + 0.02);
            sat.gain.linearRampToValueAtTime(cur, t0 + 0.35);
          } catch (_) {}
        }
      }

      /* Rare optical stab — quiet glass spike, not a club hit. */
      function dropStab() {
        if (!humNodes || humNodes !== nodes || muted || reduce || !nodes.inDrop) return;
        if (playSample(c, "stab", stemPulse, opticsLo ? 0.08 : 0.12)) return;
        var t0 = c.currentTime;
        var base = phoneAudio ? 196 : 156;
        var bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = phoneAudio ? 980 : 1180;
        bp.Q.value = 2.6;
        var g = c.createGain();
        g.gain.value = 0;
        bp.connect(g);
        g.connect(stemPulse);
        var dets = [-7, 0, 9];
        for (var i = 0; i < dets.length; i++) {
          var o = c.createOscillator();
          o.type = "sawtooth";
          o.frequency.setValueAtTime(base + dets[i], t0);
          o.frequency.exponentialRampToValueAtTime(base * 0.75 + dets[i] * 0.5, t0 + 0.1);
          o.connect(bp);
          o.start(t0);
          o.stop(t0 + 0.13);
        }
        g.gain.linearRampToValueAtTime(opticsLo ? 0.01 : 0.016, t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
      }

      /* Drop-only metallic BP tick — soft phosphor ping. */
      function dropMetalTick() {
        if (!humNodes || humNodes !== nodes || muted || reduce || !nodes.inDrop) return;
        var t0 = c.currentTime;
        var car = c.createOscillator();
        var mod = c.createOscillator();
        var modG = c.createGain();
        var bp = c.createBiquadFilter();
        var g = c.createGain();
        car.type = "triangle";
        mod.type = "sine";
        car.frequency.setValueAtTime(phoneAudio ? 720 : 620, t0);
        mod.frequency.value = phoneAudio ? 38 : 28;
        modG.gain.value = phoneAudio ? 90 : 120;
        mod.connect(modG);
        modG.connect(car.frequency);
        bp.type = "bandpass";
        bp.frequency.value = phoneAudio ? 1100 : 980;
        bp.Q.value = 4.5;
        g.gain.value = 0;
        car.connect(bp);
        bp.connect(g);
        g.connect(stemPulse);
        var peak = opticsLo ? 0.005 : 0.008;
        g.gain.linearRampToValueAtTime(peak, t0 + 0.0015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
        car.start(t0);
        mod.start(t0);
        car.stop(t0 + 0.055);
        mod.stop(t0 + 0.055);
      }

      function filterStab() {
        if (!humNodes || humNodes !== nodes) return;
        var t0 = c.currentTime;
        var base = phoneAudio ? 420 : 280;
        var open = nodes.inDrop ? (phoneAudio ? 820 : 640) : phoneAudio ? 720 : 560;
        try {
          filter.frequency.cancelScheduledValues(t0);
          filter.frequency.setValueAtTime(filter.frequency.value, t0);
          filter.frequency.linearRampToValueAtTime(open, t0 + 0.08);
          filter.frequency.linearRampToValueAtTime(base, t0 + 0.55);
        } catch (_) {}
      }

      function onBeat() {
        if (!humNodes || humNodes !== nodes || muted || reduce) return;
        var b = nodes.beat % 16;
        nodes.beat += 1;
        advanceChordProgression();
        /* No club grid. Sparse optical clock only. */
        if (
          !nodes.inHush &&
          !nodes.inVacuum &&
          !nodes.inDrop &&
          !nodes.readFocus &&
          (nodes.mode === "ambient" || nodes.mode === "pulse" || nodes.mode === "bloom") &&
          b === 0 &&
          nodes.beat % 8 === 1
        ) {
          sidechainPump({
            bassOnly: true,
            bassDepth: 0.86,
            bassMs: 0.48,
            airDepth: 0.78,
            airMs: 0.62,
          });
        }
        if (nodes.inDrop) {
          if (nodes.inTaper) {
            if (b % 8 === 0) coldSatTick();
            return;
          }
          /* Glass event: rim tick + soft filter open — not a rave drop. */
          if (b % 8 === 0) {
            dropRim();
            filterStab();
            dropMetalTick();
          }
          if (b % 8 === 4 && Math.random() < 0.55) metalFleck();
          if (b === 0 && Math.random() < 0.4) dropStab();
          return;
        }
        if (nodes.inHush || nodes.inVacuum || nodes.readFocus) return;
        if (nodes.mode === "bloom" && b === 0 && Math.random() < 0.35) filterStab();
        if (Math.random() < (nodes.mode === "ambient" ? 0.05 : 0.1)) metalFleck();
        if (b === 0 && Math.random() < 0.05) hullThud();
        if (b === 0 && nodes.mode === "bloom" && Math.random() < 0.12) reverseSwell();
      }

      function scheduleGrid() {
        if (!humNodes || humNodes !== nodes || muted || reduce) return;
        onBeat();
        nodes.pulseTimer = setTimeout(scheduleGrid, BEAT_MS);
      }

      function morphFx(mode, rampSec) {
        if (!nodes.delayWet || !nodes.delaySend) return;
        var t = c.currentTime;
        var s = rampSec == null ? 2.2 : rampSec;
        var delayAmt =
          mode === "drop"
            ? opticsLo
              ? 0.1
              : 0.14
            : mode === "bloom"
              ? opticsLo
                ? 0.09
                : 0.13
              : mode === "pulse"
                ? opticsLo
                  ? 0.07
                  : 0.1
                : mode === "hush" || mode === "vacuum"
                  ? 0.03
                  : opticsLo
                    ? 0.05
                    : 0.08;
        var sendAmt =
          mode === "drop" || mode === "bloom" ? 0.28 : mode === "pulse" ? 0.22 : mode === "hush" ? 0.12 : 0.18;
        var fbAmt = mode === "drop" ? 0.32 : mode === "bloom" ? 0.28 : 0.22;
        var delayTone = mode === "bloom" ? (phoneAudio ? 1800 : 1600) : phoneAudio ? 1500 : 1300;
        var driveAmt =
          mode === "drop"
            ? opticsLo
              ? 0.16
              : 0.22
            : mode === "bloom"
              ? opticsLo
                ? 0.12
                : 0.18
              : mode === "hush" || mode === "vacuum"
                ? 0.04
                : opticsLo
                  ? 0.08
                  : 0.12;
        if (nodes.readFocus) {
          delayAmt *= 0.45;
          sendAmt *= 0.5;
          driveAmt *= 0.55;
          fbAmt = Math.min(fbAmt, 0.18);
        }
        try {
          nodes.delayWet.gain.cancelScheduledValues(t);
          nodes.delayWet.gain.linearRampToValueAtTime(delayAmt, t + s);
          nodes.delaySend.gain.cancelScheduledValues(t);
          nodes.delaySend.gain.linearRampToValueAtTime(sendAmt, t + s);
          if (nodes.delayFb) {
            nodes.delayFb.gain.cancelScheduledValues(t);
            nodes.delayFb.gain.linearRampToValueAtTime(fbAmt, t + s);
          }
          if (nodes.delayLp) {
            nodes.delayLp.frequency.cancelScheduledValues(t);
            nodes.delayLp.frequency.linearRampToValueAtTime(delayTone, t + s);
          }
          if (nodes.landDriveWet) {
            nodes.landDriveWet.gain.cancelScheduledValues(t);
            nodes.landDriveWet.gain.linearRampToValueAtTime(driveAmt, t + s);
          }
          if (nodes.landFilter) {
            var open =
              mode === "bloom"
                ? phoneAudio
                  ? 300
                  : 260
                : mode === "drop"
                  ? phoneAudio
                    ? 260
                    : 220
                  : mode === "pulse"
                    ? phoneAudio
                      ? 240
                      : 200
                    : phoneAudio
                      ? 200
                      : 160;
            nodes.landFilter.frequency.cancelScheduledValues(t);
            nodes.landFilter.frequency.linearRampToValueAtTime(open, t + s);
          }
          /* Slow HP/BP morph on hush air — darken without mud. */
          if (hissBp && (mode === "hush" || mode === "vacuum" || mode === "bloom")) {
            hissBp.frequency.cancelScheduledValues(t);
            hissBp.frequency.linearRampToValueAtTime(
              mode === "bloom" ? (phoneAudio ? 980 : 860) : phoneAudio ? 720 : 640,
              t + s
            );
          }
        } catch (_) {}
      }

      function setAtmosphere(mode) {
        if (!humNodes || humNodes !== nodes || !bedGroup) return;
        if (nodes.inDrop && mode !== "drop") return;
        if (nodes.inHush && mode !== "drop" && mode !== "hush") return;
        if (nodes.inVacuum && mode !== "ambient" && mode !== "vacuum") return;
        var t = c.currentTime;
        nodes.mode = mode === "hush" || mode === "vacuum" ? "ambient" : mode;
        var sat = bedGroup.satWet;
        var vSend = bedGroup.verbSend;
        var vWet = bedGroup.verbWet;
        var rate = BPM / 60;
        var ramp = mode === "drop" ? 0.85 : mode === "hush" || mode === "vacuum" ? 1.4 : 2.2;
        try {
          pulseLfo.frequency.setValueAtTime(rate, t);
          filtLfo.frequency.setValueAtTime(rate, t);
          bassAmLfo.frequency.setValueAtTime(rate, t);
          if (mode === "drop") {
            nodes.stems = { bass: 1.05, hiss: 0.7, pulse: 0.55, shim: 0.55, tex: 1.05, kick: false, pump: false };
            rampStem(stemBass, 1.05, ramp);
            rampStem(stemHiss, 0.7, ramp);
            rampStem(stemPulse, 0.55, ramp);
            rampStem(stemShim, 0.55, ramp);
            rampStem(stemTex, texStemTarget("drop"), ramp);
            texGain.gain.cancelScheduledValues(t);
            texGain.gain.linearRampToValueAtTime(texNoiseTarget("drop"), t + ramp);
            var dAmt = opticsLo ? 0.01 : phoneAudio ? 0.014 : 0.018;
            pulseGain.gain.cancelScheduledValues(t);
            pulseGain.gain.linearRampToValueAtTime(dAmt, t + ramp);
            pulseDepth.gain.cancelScheduledValues(t);
            pulseDepth.gain.linearRampToValueAtTime(dAmt, t + ramp);
            filtDepth.gain.cancelScheduledValues(t);
            filtDepth.gain.linearRampToValueAtTime(phoneAudio ? 70 : 90, t + ramp);
            filter.frequency.linearRampToValueAtTime(phoneAudio ? 560 : 420, t + ramp);
            sat.gain.cancelScheduledValues(t);
            sat.gain.linearRampToValueAtTime(opticsLo ? 0.28 : 0.38, t + ramp);
            vSend.gain.linearRampToValueAtTime(phoneAudio ? 0.22 : 0.3, t + ramp);
            vWet.gain.linearRampToValueAtTime(phoneAudio ? 0.26 : 0.34, t + ramp);
            shimGain.gain.cancelScheduledValues(t);
            shimGain.gain.linearRampToValueAtTime(opticsLo ? 0.008 : 0.012, t + ramp);
            chordGain.gain.cancelScheduledValues(t);
            chordGain.gain.linearRampToValueAtTime(chordTarget("drop"), t + ramp);
            bassAmDepth.gain.cancelScheduledValues(t);
            bassAmDepth.gain.linearRampToValueAtTime(amDepthFor("drop"), t + ramp);
            if (nodes.gain) {
              nodes.gain.gain.cancelScheduledValues(t);
              nodes.gain.gain.linearRampToValueAtTime(bedTarget() * 1.12, t + ramp);
            }
            lfo.frequency.linearRampToValueAtTime(0.03, t + ramp);
            rampCine("drop", ramp);
          } else if (mode === "hush") {
            nodes.stems = { bass: 0.85, hiss: 0.55, pulse: 0.0001, shim: 0.15, tex: 0.45, kick: false, pump: false };
            rampStem(stemBass, 0.85, ramp);
            rampStem(stemHiss, 0.55, ramp);
            rampStem(stemPulse, 0.0001, ramp);
            rampStem(stemShim, 0.15, ramp);
            rampStem(stemTex, 0.45, ramp);
            texGain.gain.cancelScheduledValues(t);
            texGain.gain.linearRampToValueAtTime(texNoiseTarget("ambient") * 0.6, t + ramp);
            pulseGain.gain.cancelScheduledValues(t);
            pulseGain.gain.linearRampToValueAtTime(0.0001, t + ramp);
            pulseDepth.gain.cancelScheduledValues(t);
            pulseDepth.gain.linearRampToValueAtTime(0.0001, t + ramp);
            filtDepth.gain.cancelScheduledValues(t);
            filtDepth.gain.linearRampToValueAtTime(8, t + ramp);
            filter.frequency.linearRampToValueAtTime(phoneAudio ? 300 : 200, t + ramp);
            sat.gain.cancelScheduledValues(t);
            sat.gain.linearRampToValueAtTime(opticsLo ? 0.22 : 0.3, t + ramp);
            vSend.gain.linearRampToValueAtTime(phoneAudio ? 0.12 : 0.16, t + ramp);
            shimGain.gain.cancelScheduledValues(t);
            shimGain.gain.linearRampToValueAtTime(0.0012, t + ramp);
            chordGain.gain.cancelScheduledValues(t);
            chordGain.gain.linearRampToValueAtTime(0.0004, t + ramp);
            bassAmDepth.gain.cancelScheduledValues(t);
            bassAmDepth.gain.linearRampToValueAtTime(0.01, t + ramp);
            if (nodes.gain) {
              nodes.gain.gain.cancelScheduledValues(t);
              nodes.gain.gain.linearRampToValueAtTime(bedTarget() * 0.88, t + ramp);
            }
            rampCine("hush", ramp);
          } else if (mode === "vacuum") {
            nodes.stems = { bass: 0.7, hiss: 0.7, pulse: 0.0001, shim: 0.12, tex: 0.4, kick: false, pump: false };
            rampStem(stemBass, 0.7, ramp);
            rampStem(stemHiss, 0.7, ramp);
            rampStem(stemPulse, 0.0001, ramp);
            rampStem(stemShim, 0.12, ramp);
            rampStem(stemTex, 0.4, ramp);
            texGain.gain.cancelScheduledValues(t);
            texGain.gain.linearRampToValueAtTime(texNoiseTarget("ambient") * 0.5, t + ramp);
            pulseGain.gain.cancelScheduledValues(t);
            pulseGain.gain.linearRampToValueAtTime(0.0001, t + ramp);
            pulseDepth.gain.linearRampToValueAtTime(0.0001, t + ramp);
            filtDepth.gain.linearRampToValueAtTime(0, t + ramp);
            filter.frequency.linearRampToValueAtTime(phoneAudio ? 360 : 240, t + ramp);
            sat.gain.cancelScheduledValues(t);
            sat.gain.linearRampToValueAtTime(opticsLo ? 0.08 : 0.1, t + ramp);
            vSend.gain.linearRampToValueAtTime(phoneAudio ? 0.1 : 0.14, t + ramp);
            shimGain.gain.cancelScheduledValues(t);
            shimGain.gain.linearRampToValueAtTime(0.0008, t + ramp);
            chordGain.gain.cancelScheduledValues(t);
            chordGain.gain.linearRampToValueAtTime(0.0002, t + ramp);
            bassAmDepth.gain.cancelScheduledValues(t);
            bassAmDepth.gain.linearRampToValueAtTime(0.008, t + ramp);
            if (nodes.gain) {
              nodes.gain.gain.cancelScheduledValues(t);
              nodes.gain.gain.linearRampToValueAtTime(bedTarget() * 0.75, t + ramp);
            }
            rampCine("vacuum", ramp);
          } else if (mode === "pulse") {
            /* Optical breathe — soft sub swell, never kick grid. */
            nodes.stems = { bass: 1, hiss: 0.9, pulse: 0.7, shim: 0.4, tex: 0.8, kick: false, pump: false };
            rampStem(stemBass, 1, 2);
            rampStem(stemHiss, 0.9, 2);
            rampStem(stemPulse, 0.7, 2.2);
            rampStem(stemShim, 0.4, 2.2);
            rampStem(stemTex, texStemTarget("pulse"), 2.2);
            texGain.gain.cancelScheduledValues(t);
            texGain.gain.linearRampToValueAtTime(texNoiseTarget("pulse"), t + 2.2);
            var pAmt = opticsLo ? 0.008 : phoneAudio ? 0.012 : 0.015;
            pulseGain.gain.cancelScheduledValues(t);
            pulseGain.gain.linearRampToValueAtTime(pAmt, t + 2.2);
            pulseDepth.gain.cancelScheduledValues(t);
            pulseDepth.gain.linearRampToValueAtTime(pAmt, t + 2.2);
            filtDepth.gain.cancelScheduledValues(t);
            filtDepth.gain.linearRampToValueAtTime(phoneAudio ? 45 : 60, t + 2.2);
            filter.frequency.linearRampToValueAtTime(phoneAudio ? 480 : 340, t + 2.4);
            sat.gain.cancelScheduledValues(t);
            sat.gain.linearRampToValueAtTime(opticsLo ? 0.28 : 0.38, t + 2.5);
            vSend.gain.linearRampToValueAtTime(phoneAudio ? 0.24 : 0.32, t + 2);
            vWet.gain.linearRampToValueAtTime(phoneAudio ? 0.28 : 0.36, t + 2);
            shimGain.gain.cancelScheduledValues(t);
            shimGain.gain.linearRampToValueAtTime(opticsLo ? 0.006 : 0.01, t + 2.5);
            chordGain.gain.cancelScheduledValues(t);
            chordGain.gain.linearRampToValueAtTime(chordTarget("pulse"), t + 2.2);
            bassAmDepth.gain.cancelScheduledValues(t);
            bassAmDepth.gain.linearRampToValueAtTime(amDepthFor("pulse"), t + 2.2);
            if (nodes.gain) {
              nodes.gain.gain.cancelScheduledValues(t);
              nodes.gain.gain.linearRampToValueAtTime(bedTarget(), t + 2);
            }
            lfo.frequency.linearRampToValueAtTime(0.04, t + 2);
            rampCine("pulse", 2.2);
          } else if (mode === "bloom") {
            nodes.stems = { bass: 0.9, hiss: 1, pulse: 0.25, shim: 0.85, tex: 0.95, kick: false, pump: false };
            rampStem(stemBass, 0.9, 2);
            rampStem(stemHiss, 1, 2);
            rampStem(stemPulse, 0.45, 2);
            rampStem(stemShim, 0.85, 2);
            rampStem(stemTex, texStemTarget("bloom"), 2.2);
            texGain.gain.cancelScheduledValues(t);
            texGain.gain.linearRampToValueAtTime(texNoiseTarget("bloom"), t + 2.2);
            pulseGain.gain.cancelScheduledValues(t);
            pulseGain.gain.linearRampToValueAtTime(0.004, t + 2);
            pulseDepth.gain.cancelScheduledValues(t);
            pulseDepth.gain.linearRampToValueAtTime(0.004, t + 2);
            filtDepth.gain.linearRampToValueAtTime(24, t + 2);
            sat.gain.cancelScheduledValues(t);
            sat.gain.linearRampToValueAtTime(opticsLo ? 0.4 : 0.55, t + 2.8);
            vSend.gain.linearRampToValueAtTime(phoneAudio ? 0.28 : 0.36, t + 2);
            vWet.gain.linearRampToValueAtTime(phoneAudio ? 0.32 : 0.4, t + 2);
            shimGain.gain.cancelScheduledValues(t);
            shimGain.gain.linearRampToValueAtTime(opticsLo ? 0.008 : 0.013, t + 2.2);
            chordGain.gain.cancelScheduledValues(t);
            chordGain.gain.linearRampToValueAtTime(chordTarget("bloom"), t + 2.2);
            bassAmDepth.gain.cancelScheduledValues(t);
            bassAmDepth.gain.linearRampToValueAtTime(amDepthFor("bloom"), t + 2.2);
            if (nodes.gain) {
              nodes.gain.gain.cancelScheduledValues(t);
              nodes.gain.gain.linearRampToValueAtTime(bedTarget(), t + 2);
            }
            filter.frequency.linearRampToValueAtTime(phoneAudio ? 520 : 400, t + 2.5);
            lfo.frequency.linearRampToValueAtTime(0.07, t + 2);
            rampCine("bloom", 2.4);
          } else {
            nodes.stems = { bass: 1, hiss: 1, pulse: 0, shim: 0.3, tex: 0.75, kick: false, pump: false };
            rampStem(stemBass, 1, 2.5);
            rampStem(stemHiss, 1, 2.5);
            rampStem(stemPulse, 0.0001, 2.5);
            rampStem(stemShim, 0.3, 2.5);
            rampStem(stemTex, texStemTarget("ambient"), 2.5);
            texGain.gain.cancelScheduledValues(t);
            texGain.gain.linearRampToValueAtTime(texNoiseTarget("ambient"), t + 2.5);
            pulseGain.gain.cancelScheduledValues(t);
            pulseGain.gain.linearRampToValueAtTime(0.0001, t + 2.5);
            pulseDepth.gain.cancelScheduledValues(t);
            pulseDepth.gain.linearRampToValueAtTime(0.0001, t + 2.5);
            filtDepth.gain.cancelScheduledValues(t);
            filtDepth.gain.linearRampToValueAtTime(0, t + 2.5);
            sat.gain.cancelScheduledValues(t);
            sat.gain.linearRampToValueAtTime(opticsLo ? 0.12 : 0.16, t + 2.5);
            vSend.gain.linearRampToValueAtTime(phoneAudio ? 0.48 : 0.62, t + 2);
            vWet.gain.linearRampToValueAtTime(phoneAudio ? 0.52 : 0.68, t + 2);
            shimGain.gain.cancelScheduledValues(t);
            shimGain.gain.linearRampToValueAtTime(opticsLo ? 0.0022 : 0.0038, t + 2.5);
            chordGain.gain.cancelScheduledValues(t);
            chordGain.gain.linearRampToValueAtTime(chordTarget("ambient"), t + 2.5);
            bassAmDepth.gain.cancelScheduledValues(t);
            bassAmDepth.gain.linearRampToValueAtTime(amDepthFor("ambient"), t + 2.5);
            if (nodes.gain) {
              nodes.gain.gain.cancelScheduledValues(t);
              nodes.gain.gain.linearRampToValueAtTime(bedTarget(), t + 2.5);
            }
            filter.frequency.linearRampToValueAtTime(phoneAudio ? 420 : 280, t + 2.5);
            lfo.frequency.linearRampToValueAtTime(0.055, t + 2);
            rampCine("ambient", 2.6);
          }
          morphFx(mode, ramp);
        } catch (_) {}
      }

      function enterHush() {
        if (!humNodes || humNodes !== nodes || muted || reduce) return;
        if (nodes.inHush || nodes.inDrop || nodes.inVacuum) return;
        nodes.priorMode = nodes.mode === "drop" ? "ambient" : nodes.mode;
        nodes.inHush = true;
        setAtmosphere("hush");
      }

      function enterVacuum() {
        if (!humNodes || humNodes !== nodes) return;
        nodes.inVacuum = true;
        nodes.inHush = false;
        nodes.inTaper = false;
        setAtmosphere("vacuum");
        var hold = 5500 + Math.random() * 3500;
        nodes.vacuumTimer = setTimeout(function () {
          if (!humNodes || humNodes !== nodes) return;
          nodes.inVacuum = false;
          nodes.vacuumTimer = null;
          var restore = "ambient";
          setAtmosphere(restore);
          scheduleDrop();
          scheduleAtmosphere();
        }, hold);
      }

      function exitDrop() {
        if (!humNodes || humNodes !== nodes) return;
        nodes.inDrop = false;
        nodes.inTaper = false;
        nodes.dropEndTimer = null;
        nodes.dropTaperTimer = null;
        enterVacuum();
      }

      function enterDrop() {
        if (!humNodes || humNodes !== nodes || muted || reduce) return;
        if (nodes.inDrop) return;
        if (!nodes.inHush) {
          nodes.priorMode = nodes.mode === "drop" ? "ambient" : nodes.mode;
        }
        nodes.inHush = false;
        nodes.inVacuum = false;
        nodes.inDrop = true;
        nodes.inTaper = false;
        nodes.ritualCount = (nodes.ritualCount || 0) + 1;
        setAtmosphere("drop");
        coldSatTick();
        filterStab();
        dropStab();
        dropMetalTick();
        ritualGong();
        /* Ritual event — hold then long vacuum (geology, not drop party). */
        var holdMs = 10000 + Math.random() * 6000;
        nodes.dropTaperTimer = setTimeout(function () {
          if (!humNodes || humNodes !== nodes || !nodes.inDrop || !bedGroup) return;
          nodes.inTaper = true;
          var t = c.currentTime;
          try {
            bedGroup.satWet.gain.cancelScheduledValues(t);
            bedGroup.satWet.gain.linearRampToValueAtTime(opticsLo ? 0.16 : 0.2, t + 1.4);
            pulseGain.gain.cancelScheduledValues(t);
            pulseGain.gain.linearRampToValueAtTime((opticsLo ? 0.005 : 0.008), t + 1.4);
            chordGain.gain.cancelScheduledValues(t);
            chordGain.gain.linearRampToValueAtTime(0.0015, t + 1.4);
            filter.frequency.linearRampToValueAtTime(phoneAudio ? 380 : 260, t + 1.5);
          } catch (_) {}
        }, Math.max(4000, holdMs - 2000));
        nodes.dropEndTimer = setTimeout(exitDrop, holdMs);
      }

      function scheduleHushWatch() {
        if (!humNodes || humNodes !== nodes || muted || reduce) return;
        nodes.hushWatchTimer = setTimeout(function () {
          if (!humNodes || humNodes !== nodes || muted || reduce) return;
          var until = nodes.dropDueAt ? nodes.dropDueAt - Date.now() : 0;
          if (until > 0 && until < 6000 && !nodes.inDrop && !nodes.inHush && !nodes.inVacuum) {
            enterHush();
          }
          scheduleHushWatch();
        }, 900);
      }

      function scheduleDrop() {
        if (!humNodes || humNodes !== nodes || muted || (!audioForced && reduce)) return;
        /* First ritual ~28–55s (horn choir already running); later geology-time. */
        var n = nodes.ritualCount || 0;
        var wait;
        if (n === 0) {
          wait = nodes.readFocus
            ? 45000 + Math.random() * 25000
            : 28000 + Math.random() * 25000;
        } else {
          wait = nodes.readFocus
            ? 180000 + Math.random() * 180000
            : 120000 + Math.random() * 120000;
        }
        nodes.dropDueAt = Date.now() + wait;
        if (nodes.dropTimer) clearTimeout(nodes.dropTimer);
        nodes.dropTimer = setTimeout(function () {
          if (!humNodes || humNodes !== nodes || muted || reduce) return;
          nodes.dropDueAt = 0;
          enterDrop();
        }, wait);
      }

      function scheduleAtmosphere() {
        if (!humNodes || humNodes !== nodes || muted || reduce) return;
        if (nodes.inDrop || nodes.inHush || nodes.inVacuum) {
          nodes.atmTimer = setTimeout(scheduleAtmosphere, BEAT_MS * 8);
          return;
        }
        var elapsed = Date.now() - (nodes.bedStartedAt || Date.now());
        var untilDrop = nodes.dropDueAt ? nodes.dropDueAt - Date.now() : 0;
        var r = Math.random();
        var mode;
        /* Faraday pace: ambient home; bloom = cinematic landscape weather; pulse = soft breathe. */
        if (nodes.readFocus || elapsed < 120000) {
          mode = elapsed < 60000 ? "ambient" : r < 0.78 ? "ambient" : "bloom";
        } else if (untilDrop > 0 && untilDrop < 45000) {
          mode = r < 0.7 ? "bloom" : "ambient";
        } else {
          /* Geology-time: ambient is home; bloom rare weather; pulse almost never. */
          mode = r < 0.72 ? "ambient" : r < 0.96 ? "bloom" : "pulse";
        }
        setAtmosphere(mode);
        nodes.atmTimer = setTimeout(scheduleAtmosphere, BEAT_MS * (16 + Math.floor(Math.random() * 22)));
      }

      function scheduleCrackle() {
        if (!humNodes || humNodes !== nodes || muted || reduce) return;
        var wait = 2200 + Math.random() * 5000;
        nodes.crackleTimer = setTimeout(function () {
          if (!humNodes || humNodes !== nodes || muted || reduce) {
            scheduleCrackle();
            return;
          }
          /* Ambient flecks only — rhythmic ticks owned by the grid / drop. */
          if (!nodes.inDrop && (nodes.mode === "ambient" || Math.random() < 0.35)) {
            var t0 = c.currentTime;
            var burst = c.createBufferSource();
            burst.buffer = noiseBuffer(c);
            var bp = c.createBiquadFilter();
            bp.type = "bandpass";
            bp.frequency.value = 2400 + Math.random() * 1800;
            bp.Q.value = 1.8;
            var g = c.createGain();
            g.gain.value = 0;
            burst.connect(bp);
            bp.connect(g);
            g.connect(stemHiss);
            var peak = (opticsLo ? 0.008 : 0.012) * (0.55 + Math.random() * 0.55);
            g.gain.linearRampToValueAtTime(peak, t0 + 0.001);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.018 + Math.random() * 0.02);
            burst.start(t0);
            burst.stop(t0 + 0.05);
          }
          scheduleCrackle();
        }, wait);
      }

      function duckPadUnderCry(sec) {
        var t = c.currentTime;
        var back = sec || 9;
        try {
          if (landGain) {
            landGain.gain.cancelScheduledValues(t);
            landGain.gain.setValueAtTime(Math.max(0.0001, landGain.gain.value), t);
            landGain.gain.linearRampToValueAtTime(0.00012, t + 0.25);
            landGain.gain.linearRampToValueAtTime(landTarget("ambient"), t + back);
          }
          if (horizonGain) {
            horizonGain.gain.cancelScheduledValues(t);
            horizonGain.gain.setValueAtTime(Math.max(0.0001, horizonGain.gain.value), t);
            horizonGain.gain.linearRampToValueAtTime(0.00008, t + 0.25);
            horizonGain.gain.linearRampToValueAtTime(opticsLo ? 0.00015 : 0.00022, t + back);
          }
          if (chordGain) {
            chordGain.gain.cancelScheduledValues(t);
            chordGain.gain.setValueAtTime(Math.max(0.0001, chordGain.gain.value), t);
            chordGain.gain.linearRampToValueAtTime(0.0006, t + 0.2);
            chordGain.gain.linearRampToValueAtTime(chordTarget("ambient"), t + back);
          }
        } catch (_) {}
      }

      function playRitualWavBody(peak) {
        var dest = ritualSampleIn;
        if (!dest) return false;
        var name =
          sampleBufs.ritual_cry && (nodes.cryCount || 0) % 2 === 0
            ? "ritual_cry"
            : sampleBufs.ritual_horn
              ? "ritual_horn"
              : sampleBufs.ritual_cry
                ? "ritual_cry"
                : null;
        if (!name || !sampleBufs[name]) return false;
        var buf = sampleBufs[name];
        var t0 = c.currentTime;
        var src = c.createBufferSource();
        var g = c.createGain();
        src.buffer = buf;
        /* Tiny irregular rate drift — animal, not siren sweep. */
        src.playbackRate.value = 0.96 + Math.random() * 0.08;
        g.gain.value = 0.0001;
        src.connect(g);
        g.connect(dest);
        var dur = buf.duration;
        var pk = peak == null ? 0.85 : peak;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(pk, t0 + 0.28 + Math.random() * 0.35);
        g.gain.setValueAtTime(pk * (0.85 + Math.random() * 0.15), t0 + Math.max(0.8, dur * 0.4));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.2);
        src.start(t0);
        src.stop(t0 + dur + 0.25);
        return dur;
      }

      function nudgeCryPartials(sec) {
        /* Irregular micro-cent drifts during a cry — never 0.5–2 Hz woo-woo. */
        if (!cryVoices || !cryVoices.length) return;
        var t0 = c.currentTime;
        var end = t0 + (sec || 6);
        cryVoices.forEach(function (cv) {
          try {
            var base = cv.baseHz;
            cv.osc.frequency.cancelScheduledValues(t0);
            cv.osc.frequency.setValueAtTime(base, t0);
            var t = t0 + 0.2 + Math.random() * 0.5;
            while (t < end - 0.4) {
              var cents = (Math.random() * 2 - 1) * 22;
              var hz = base * Math.pow(2, cents / 1200);
              cv.osc.frequency.linearRampToValueAtTime(hz, t);
              t += 0.45 + Math.random() * 1.1;
            }
            cv.osc.frequency.linearRampToValueAtTime(base, end);
          } catch (_) {}
        });
      }

      function fireRitualCry() {
        if (!humNodes || humNodes !== nodes || muted || reduce) return;
        var t = c.currentTime;
        var mood = moodOf();
        var cryMul = mood.cry != null ? mood.cry : 1;
        var underMul = mood.under != null ? mood.under : 1;
        var peak = ritualCryPeak * cryMul * (opticsLo ? 0.85 : 1);
        var under = ritualUnderPeak * underMul;
        var rise = 0.9 + Math.random() * 1.1;
        var hold = 3.2 + Math.random() * 2.8;
        var fall = 4.5 + Math.random() * 3.5;
        duckPadUnderCry(rise + hold + fall + 2);
        var wavDur = playRitualWavBody(phoneAudio ? 0.95 : 0.88);
        var hasWav = wavDur !== false;
        if (hasWav) {
          /* WAV is body — shorter synth swell as thicken only. */
          hold = Math.min(hold, Math.max(2.4, wavDur * 0.55));
          fall = Math.min(fall, 4.2);
        }
        try {
          ritualGain.gain.cancelScheduledValues(t);
          ritualGain.gain.setValueAtTime(Math.max(0.0001, ritualGain.gain.value), t);
          ritualGain.gain.linearRampToValueAtTime(peak, t + rise);
          ritualGain.gain.linearRampToValueAtTime(under * 1.15, t + rise + hold);
          ritualGain.gain.linearRampToValueAtTime(under, t + rise + hold + fall);
          /* Synth thicken only while cry lives — then back to void. */
          if (cryBodyG && cryEdgeG) {
            var synPeak = hasWav ? (phoneAudio ? 0.22 : 0.18) : phoneAudio ? 0.55 : 0.48;
            cryBodyG.gain.cancelScheduledValues(t);
            cryEdgeG.gain.cancelScheduledValues(t);
            cryBodyG.gain.setValueAtTime(Math.max(0.0001, cryBodyG.gain.value), t);
            cryEdgeG.gain.setValueAtTime(Math.max(0.0001, cryEdgeG.gain.value), t);
            cryBodyG.gain.linearRampToValueAtTime(synPeak, t + rise);
            cryEdgeG.gain.linearRampToValueAtTime(synPeak * 0.7, t + rise);
            cryBodyG.gain.linearRampToValueAtTime(0.0001, t + rise + hold + fall * 0.7);
            cryEdgeG.gain.linearRampToValueAtTime(0.0001, t + rise + hold + fall * 0.7);
          }
          nudgeCryPartials(rise + hold);
          if (cryEchoSend) {
            cryEchoSend.gain.cancelScheduledValues(t);
            cryEchoSend.gain.setValueAtTime(Math.max(0.05, cryEchoSend.gain.value), t);
            cryEchoSend.gain.linearRampToValueAtTime(phoneAudio ? 0.82 : 0.95, t + rise);
            cryEchoSend.gain.linearRampToValueAtTime(phoneAudio ? 0.5 : 0.62, t + rise + hold + fall);
          }
          if (bedGroup && bedGroup.verbWet) {
            bedGroup.verbWet.gain.cancelScheduledValues(t);
            bedGroup.verbWet.gain.setValueAtTime(Math.max(0.2, bedGroup.verbWet.gain.value), t);
            bedGroup.verbWet.gain.linearRampToValueAtTime(phoneAudio ? 0.8 : 0.95, t + rise);
            bedGroup.verbWet.gain.linearRampToValueAtTime(phoneAudio ? 0.62 : 0.78, t + rise + hold + fall + 1.5);
          }
        } catch (_) {}
        nodes.cryCount = (nodes.cryCount || 0) + 1;
      }

      function scheduleCry() {
        if (!humNodes || humNodes !== nodes || muted || (!audioForced && reduce)) return;
        var n = nodes.cryCount || 0;
        var mood = moodOf();
        var gapMul = mood.cryGap != null ? mood.cryGap : 1;
        /* First cry ~2.5–5s (identity); then long void. Archive = rarer/distant. */
        var wait;
        if (n === 0) {
          if (bedMood === "archive") wait = 7000 + Math.random() * 5000;
          else if (bedMood === "tension") wait = 2200 + Math.random() * 1800;
          else wait = 2800 + Math.random() * 2200;
        } else {
          wait = (20000 + Math.random() * 26000) * gapMul;
        }
        if (nodes.cryTimer) clearTimeout(nodes.cryTimer);
        nodes.cryTimer = setTimeout(function () {
          if (!humNodes || humNodes !== nodes || muted || reduce) return;
          fireRitualCry();
          scheduleCry();
        }, wait);
      }

      humNodes = nodes;
      setTimeout(function () {
        if (humNodes === nodes) {
          setAtmosphere("ambient");
          scheduleAtmosphere();
          scheduleGrid();
          scheduleCrackle();
          scheduleDrop();
          scheduleHushWatch();
          scheduleCry();
        }
      }, 400);
    }
    function go() {
      if (c.state === "suspended") {
        c.resume().then(build).catch(build);
      } else {
        build();
      }
    }
    loadBedSamples(c).then(go).catch(go);
  }

  /* Phosphor bip — short, mid-high, reader-clear */
  function tone(freq, dur, type, vol, when) {
    if (muted || reduce || !uiBus) return;
    var c = ensureCtx();
    if (!c || !uiBus) return;
    var o = c.createOscillator();
    var g = c.createGain();
    var bp = c.createBiquadFilter();
    o.type = type || "square";
    var t0 = (when == null ? c.currentTime : when);
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.88), t0 + dur);
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 1.4;
    g.gain.value = 0;
    o.connect(bp);
    bp.connect(g);
    g.connect(uiBus);
    var peak = vol == null ? 0.045 : vol;
    g.gain.linearRampToValueAtTime(peak, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  /* Keyboard clac — noise tick + drummy key thump (mid, not sub — leaves bed alone) */
  var noiseBuf = null;
  function noiseBuffer(c) {
    if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
    var n = Math.floor(c.sampleRate * 0.05);
    var buf = c.createBuffer(1, n, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.8);
    }
    noiseBuf = buf;
    return buf;
  }
  function clack(vol, when) {
    if (muted || reduce || !uiBus) return;
    var c = ensureCtx();
    if (!c || !uiBus) return;
    var t0 = when == null ? c.currentTime : when;
    var v = vol == null ? 0.09 : vol;

    var src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    var hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    var bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2200;
    bp.Q.value = 1.2;
    var peaking = c.createBiquadFilter();
    peaking.type = "peaking";
    peaking.frequency.value = 2800;
    peaking.Q.value = 0.9;
    peaking.gain.value = 2.2;
    var ng = c.createGain();
    ng.gain.value = 0;
    src.connect(hp);
    hp.connect(bp);
    bp.connect(peaking);
    peaking.connect(ng);
    ng.connect(uiBus);
    ng.gain.linearRampToValueAtTime(v, t0 + 0.0008);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.028);
    src.start(t0);
    src.stop(t0 + 0.036);

    /* Drummy key body — ~180–90 Hz, not 62 Hz (bed owns the sub). */
    var thump = c.createOscillator();
    var tg = c.createGain();
    var tp = c.createBiquadFilter();
    thump.type = "triangle";
    thump.frequency.setValueAtTime(220, t0);
    thump.frequency.exponentialRampToValueAtTime(95, t0 + 0.05);
    tp.type = "lowpass";
    tp.frequency.value = 520;
    tp.Q.value = 0.9;
    tg.gain.value = 0;
    thump.connect(tp);
    tp.connect(tg);
    tg.connect(uiBus);
    tg.gain.linearRampToValueAtTime(v * 0.55, t0 + 0.0015);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.058);
    thump.start(t0);
    thump.stop(t0 + 0.065);
  }

  /* Perfect layer: clac (keyboard) + bip (phosphor) + short bed duck */
  function uiHit(kind) {
    if (muted || reduce) return;
    var c = ensureCtx();
    if (!c) return;
    startHum();
    var t0 = c.currentTime;
    duckBed(kind === "soft" ? 70 : 95, kind === "hash" ? 0.28 : 0.4);

    if (kind === "log") {
      clack(0.11, t0);
      tone(980, 0.042, "square", 0.048, t0 + 0.001);
      clack(0.072, t0 + 0.048);
      tone(720, 0.032, "square", 0.034, t0 + 0.049);
    } else if (kind === "soft") {
      clack(0.088, t0);
      tone(640, 0.036, "triangle", 0.04, t0 + 0.001);
    } else if (kind === "hash") {
      clack(0.078, t0);
      tone(280, 0.028, "sawtooth", 0.028, t0 + 0.001);
      clack(0.055, t0 + 0.036);
      tone(210, 0.045, "sawtooth", 0.022, t0 + 0.037);
    } else if (kind === "boot") {
      clack(0.095, t0);
      tone(520, 0.05, "triangle", 0.042, t0 + 0.002);
    } else {
      clack(0.1, t0);
      tone(880, 0.038, "square", 0.044, t0 + 0.001);
    }
  }

  function beepLog() {
    uiHit("log");
  }
  function beepSoft() {
    uiHit("soft");
  }
  function beepHash() {
    uiHit("hash");
  }
  function beepBoot() {
    uiHit("boot");
  }

  function setMuted(on) {
    muted = !!on;
    lsSet("dz_mute", muted ? "1" : "0");
    if (muted) {
      stopHum();
      /* Park AudioContext after teardown — phone win without touching glass. */
      setTimeout(function () {
        if (muted) suspendBedCtx();
      }, 320);
    } else {
      audioForced = true;
      muted = false;
      lsSet("dz_mute", "0");
      var cUnmute = ensureCtx();
      if (cUnmute && cUnmute.state === "suspended") {
        try { cUnmute.resume(); } catch (_) {}
      }
      startHum();
    }
    syncMuteControls();
  }

  /* Hidden tab: suspend bed CPU only. Optics stay full when visible again. */
  function onVisibility() {
    var hidden = !!document.hidden;
    try {
      document.documentElement.classList.toggle("page-hidden", hidden);
    } catch (_) {}
    if (hidden) {
      if (humNodes) stopHum();
      suspendBedCtx();
      return;
    }
    if (!muted && unlocked && bedAllowed()) startHum();
  }
  document.addEventListener("visibilitychange", onVisibility);
  global.addEventListener("pagehide", function () {
    if (humNodes) stopHum();
    suspendBedCtx();
  });

  function syncMuteControls() {
    document.querySelectorAll("[data-audio-mute]").forEach(function (b) {
      /* Green .on = sound ON (not muted). aria-pressed stays mute semantics. */
      b.classList.toggle("on", !muted);
      b.setAttribute("aria-pressed", muted ? "false" : "true");
      var lang = document.documentElement.lang === "fr" ? "fr" : "en";
      b.textContent = muted
        ? lang === "fr"
          ? "SON"
          : "AUD"
        : lang === "fr"
          ? "SON ON"
          : "AUD ON";
      b.title = muted
        ? lang === "fr"
          ? "Activer le son"
          : "Turn sound on"
        : lang === "fr"
          ? "Couper le son"
          : "Turn sound off";
      b.setAttribute(
        "aria-label",
        muted
          ? lang === "fr"
            ? "Son coupé — activer"
            : "Sound off — tap to enable"
          : lang === "fr"
            ? "Son activé — couper"
            : "Sound on — tap to mute"
      );
    });
  }

  function unlockOnGesture() {
    if (unlocked || muted || (!audioForced && reduce)) return;
    ensureCtx();
    startHum();
  }

  /* —— Progress (cleared panels visited) —— */
  function markPanel(n) {
    var key = "dz_log_seen";
    var raw = lsGet(key) || "";
    var set = {};
    raw.split(",").forEach(function (p) {
      if (p) set[p] = 1;
    });
    set[String(n)] = 1;
    var arr = Object.keys(set)
      .map(Number)
      .filter(function (x) {
        return x >= 1 && x <= 99;
      })
      .sort(function (a, b) {
        return a - b;
      });
    lsSet(key, arr.join(","));
    return arr.length;
  }
  function seenCount() {
    var raw = lsGet("dz_log_seen") || "";
    if (!raw) return 0;
    return raw.split(",").filter(Boolean).length;
  }

  /* —— Wire chrome controls —— */
  function syncT120Stamp() {
    var el = document.getElementById("t120StampText");
    if (!el) return;
    var d = new Date();
    var mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    var dd = String(d.getUTCDate()).padStart(2, "0");
    el.textContent = "OPT · 2118." + mm + "." + dd;
  }

  /* One-shot: AUD + hold glass — never nags after first glass. */
  function maybeFirstUxHint() {
    if (reduce || lsGet("dz_ux_hint_v1") === "1") return;
    var boot = document.getElementById("boot");
    var bootPending = !!(boot && !boot.classList.contains("off"));
    var delay = bootPending ? 2800 : 1400;
    setTimeout(function () {
      if (lsGet("dz_ux_hint_v1") === "1") return;
      var lang = document.documentElement.lang === "fr" ? "fr" : "en";
      var msg =
        lang === "fr"
          ? "SON ON = son · maintenir le verre · toucher pour fermer"
          : "AUD ON = sound · hold glass · tap to dismiss";
      var crush = document.getElementById("crushHint");
      var bar = document.getElementById("hintbar");
      function dismissHints() {
        if (crush) crush.classList.remove("show");
        if (bar) bar.classList.remove("show");
        lsSet("dz_ux_hint_v1", "1");
        lsSet("dz_crush_hint", "1");
      }
      if (crush) {
        crush.classList.add("show");
        crush.setAttribute("role", "button");
        crush.setAttribute("tabindex", "0");
        crush.addEventListener("click", dismissHints, { once: true });
      }
      if (bar) {
        bar.textContent = msg;
        bar.classList.add("show");
        bar.setAttribute("role", "button");
        bar.setAttribute("tabindex", "0");
        bar.addEventListener("click", dismissHints, { once: true });
      }
      lsSet("dz_ux_hint_v1", "1");
      lsSet("dz_crush_hint", "1");
      setTimeout(dismissHints, 4200);
    }, delay);
  }

  function bindChrome() {
    applyOptics();
    syncMuteControls();
    syncOptControls();
    syncT120Stamp();
    maybeFirstUxHint();
    document.querySelectorAll("[data-audio-mute]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (muted) {
          audioForced = true;
          muted = false;
          lsSet("dz_mute", "0");
          var cClick = ensureCtx();
          if (cClick && cClick.state === "suspended") {
            try { cClick.resume(); } catch (_) {}
          }
          startHum();
          syncMuteControls();
        } else {
          setMuted(true);
        }
      });
    });
    document.querySelectorAll("[data-optics-lo]").forEach(function (b) {
      b.addEventListener("click", function () {
        setOpticsLo(!opticsLo);
        /* Rebuild bed at LO/full level — never hard-mute on optics alone. */
        if (unlocked && !muted) {
          stopHum();
          setTimeout(function () {
            if (!muted && unlocked) startHum();
          }, 280);
        }
      });
    });
    ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
      document.addEventListener(ev, unlockOnGesture, { once: true, passive: true });
    });
  }

  function forceHashLink(ms) {
    var link = document.getElementById("linkStatus");
    if (!link) return;
    link.textContent = "LINK HASH";
    link.classList.add("hash");
    beepHash();
    setTimeout(function () {
      if (!link) return;
      link.textContent = "LINK OK";
      link.classList.remove("hash");
    }, ms || 900);
  }

  fixMeta();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindChrome);
  } else {
    bindChrome();
  }

  global.DZ = {
    reduce: reduce,
    coarse: coarse,
    muted: function () {
      return muted;
    },
    setMuted: setMuted,
    opticsLo: function () {
      return opticsLo;
    },
    setOpticsLo: setOpticsLo,
    setReadFocus: function (on) {
      readFocus = !!on;
      if (humNodes) {
        humNodes.readFocus = readFocus;
        if (readFocus && ctx) {
          try {
            var t = ctx.currentTime;
            if (humNodes.pulseGain) {
              humNodes.pulseGain.gain.cancelScheduledValues(t);
              humNodes.pulseGain.gain.linearRampToValueAtTime(0.0001, t + 0.4);
            }
            if (humNodes.shimGain) {
              humNodes.shimGain.gain.cancelScheduledValues(t);
              humNodes.shimGain.gain.linearRampToValueAtTime(0.0004, t + 0.5);
            }
            if (humNodes.delayWet) {
              humNodes.delayWet.gain.cancelScheduledValues(t);
              humNodes.delayWet.gain.linearRampToValueAtTime(0.018, t + 0.55);
            }
            if (humNodes.delaySend) {
              humNodes.delaySend.gain.cancelScheduledValues(t);
              humNodes.delaySend.gain.linearRampToValueAtTime(0.05, t + 0.55);
            }
            if (humNodes.landDriveWet) {
              humNodes.landDriveWet.gain.cancelScheduledValues(t);
              humNodes.landDriveWet.gain.linearRampToValueAtTime(0.02, t + 0.55);
            }
            if (humNodes.landGain) {
              humNodes.landGain.gain.cancelScheduledValues(t);
              humNodes.landGain.gain.linearRampToValueAtTime(0.00012, t + 0.6);
            }
            if (humNodes.horizonGain) {
              humNodes.horizonGain.gain.cancelScheduledValues(t);
              humNodes.horizonGain.gain.linearRampToValueAtTime(0.00008, t + 0.6);
            }
            if (humNodes.iceGain) {
              humNodes.iceGain.gain.cancelScheduledValues(t);
              humNodes.iceGain.gain.linearRampToValueAtTime(0.0001, t + 0.5);
            }
            if (humNodes.bowGain) {
              humNodes.bowGain.gain.cancelScheduledValues(t);
              humNodes.bowGain.gain.linearRampToValueAtTime(
                opticsLo ? 0.0012 : phoneAudio ? 0.002 : 0.0025,
                t + 0.7
              );
            }
            if (humNodes.hornGain) {
              humNodes.hornGain.gain.cancelScheduledValues(t);
              humNodes.hornGain.gain.linearRampToValueAtTime(
                (humNodes.hornPeak || (opticsLo ? 0.04 : phoneAudio ? 0.045 : 0.065)) * 0.85,
                t + 0.9
              );
            }
            if (humNodes.midHornGain) {
              humNodes.midHornGain.gain.cancelScheduledValues(t);
              humNodes.midHornGain.gain.linearRampToValueAtTime(
                (humNodes.midHornPeak || 0.03) * 0.35,
                t + 0.85
              );
            }
            if (humNodes.ritualGain) {
              /* Archive: underlay near void — only rare distant cries. */
              humNodes.ritualGain.gain.cancelScheduledValues(t);
              humNodes.ritualGain.gain.linearRampToValueAtTime(
                (humNodes.ritualUnderPeak || 0.0025) * 0.35,
                t + 0.7
              );
            }
            if (humNodes.cryBodyG) {
              humNodes.cryBodyG.gain.cancelScheduledValues(t);
              humNodes.cryBodyG.gain.linearRampToValueAtTime(0.0001, t + 0.5);
            }
            if (humNodes.cryEdgeG) {
              humNodes.cryEdgeG.gain.cancelScheduledValues(t);
              humNodes.cryEdgeG.gain.linearRampToValueAtTime(0.0001, t + 0.5);
            }
            if (humNodes.metalGain) {
              humNodes.metalGain.gain.cancelScheduledValues(t);
              humNodes.metalGain.gain.linearRampToValueAtTime(0.0004, t + 0.6);
            }
            if (bedGroup && bedGroup.verbWet) {
              bedGroup.verbWet.gain.cancelScheduledValues(t);
              bedGroup.verbWet.gain.linearRampToValueAtTime(
                phoneAudio ? 0.55 : 0.72,
                t + 0.8
              );
            }
            if (humNodes.stems) {
              humNodes.stems.pulse = 0;
              humNodes.stems.kick = false;
              humNodes.stems.pump = false;
            }
            humNodes.mode = "ambient";
          } catch (_) {}
        }
      }
    },
    setBedMood: function (mood) {
      var m = mood === "thin" || mood === "tension" || mood === "archive" || mood === "story" ? mood : "story";
      bedMood = m;
      if (humNodes) humNodes.bedMood = m;
      if (!ctx || !humNodes) return;
      var sc = moodOf();
      var t = ctx.currentTime;
      try {
        if (humNodes.landGain) {
          humNodes.landGain.gain.cancelScheduledValues(t);
          humNodes.landGain.gain.linearRampToValueAtTime(
            (opticsLo ? 0.00015 : 0.0002) * (sc.land || 1),
            t + 0.8
          );
        }
        if (humNodes.horizonGain) {
          humNodes.horizonGain.gain.cancelScheduledValues(t);
          humNodes.horizonGain.gain.linearRampToValueAtTime(
            (opticsLo ? 0.00008 : 0.00012) * (sc.land || 1),
            t + 0.8
          );
        }
        if (humNodes.midHornGain) {
          humNodes.midHornGain.gain.cancelScheduledValues(t);
          humNodes.midHornGain.gain.linearRampToValueAtTime(
            (humNodes.midHornPeak || 0.03) * (sc.brass || 1) * (m === "archive" ? 0.4 : 0.7),
            t + 0.9
          );
        }
        if (humNodes.ritualGain && m !== "tension") {
          /* Tension keeps cry scheduler present; archive/thin pull underlay to void. */
          humNodes.ritualGain.gain.cancelScheduledValues(t);
          humNodes.ritualGain.gain.linearRampToValueAtTime(
            (humNodes.ritualUnderPeak || 0.0025) * (sc.under != null ? sc.under : 1),
            t + 0.7
          );
        }
        if (m === "tension" && humNodes.ritualGain) {
          humNodes.ritualGain.gain.cancelScheduledValues(t);
          humNodes.ritualGain.gain.linearRampToValueAtTime(
            (humNodes.ritualUnderPeak || 0.0025) * (sc.under != null ? sc.under : 1),
            t + 0.5
          );
        }
      } catch (_) {}
    },
    bedMood: function () {
      return bedMood;
    },
    readFocus: function () {
      return readFocus;
    },
    beepLog: beepLog,
    beepSoft: beepSoft,
    beepHash: beepHash,
    beepBoot: beepBoot,
    startHum: startHum,
    stopHum: stopHum,
    unlock: unlockOnGesture,
    markPanel: markPanel,
    seenCount: seenCount,
    forceHashLink: forceHashLink,
    syncLabels: function () {
      syncMuteControls();
      syncOptControls();
    },
    absUrl: absUrl
  };
})(window);
