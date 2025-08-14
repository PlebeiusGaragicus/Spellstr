/* Spellstr App */
(function(){
  'use strict';

  // --- Utilities ---
  const $ = sel => document.querySelector(sel);

  function setCookie(name, value, days){
    const maxAge = days ? `; max-age=${days*24*60*60}` : '';
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value || '')}; path=/${maxAge}`;
  }

  function getLocal(key, fallback){
    try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch{ return fallback; }
  }
  function setLocal(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  // --- Word List ---
  const DEFAULT_WORDS = [
    { w: 'hamburger', s: "I'd like to eat a hamburger." },
    { w: 'apple', s: 'An apple a day keeps the doctor away.' },
    { w: 'school', s: 'We walk to school every morning.' },
    { w: 'friend', s: 'My friend and I play at the park.' },
    { w: 'yellow', s: 'The sun is bright and yellow.' },
    { w: 'basket', s: 'Put the toys in the basket.' },
    { w: 'purple', s: 'She drew a purple flower.' },
    { w: 'pencil', s: 'Sharpen your pencil before class.' },
    { w: 'teacher', s: 'The teacher reads a story.' },
    { w: 'animal', s: 'The zoo has an animal show.' },
    { w: 'garden', s: 'Tomatoes are growing in the garden.' },
    { w: 'music', s: 'We listen to music together.' },
    { w: 'family', s: 'My family eats dinner at six.' },
    { w: 'window', s: 'Open the window to let in air.' },
    { w: 'cookie', s: 'She baked a chocolate chip cookie.' },
  ];

  // --- Speech ---
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voices = [];
  let preferredVoiceName = null;

  function loadVoices(){
    if(!synth) return;
    voices = synth.getVoices();
    if(!voices || !voices.length){
      // iOS/Safari populate async
      window.speechSynthesis.onvoiceschanged = () => { voices = synth.getVoices(); };
    }
  }

  function chooseVoice(){
    if(!synth || !voices.length) return null;
    const byName = preferredVoiceName && voices.find(v => v.name === preferredVoiceName);
    if(byName) return byName;
    // Prefer English voices
    const en = voices.filter(v => /en[-_]/i.test(v.lang));
    return en[0] || voices[0];
  }

  function speak(text, opts={}){
    if(!synth){
      $('#tts-hint').textContent = 'Speech not supported in this browser.';
      return Promise.resolve();
    }
    return new Promise(resolve => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        const v = chooseVoice();
        if(v) u.voice = v;
        u.rate = opts.rate ?? 0.95;
        u.pitch = opts.pitch ?? 1.0;
        u.onend = resolve;
        u.onerror = resolve;
        synth.cancel(); // stop any current speech
        synth.speak(u);
      } catch {
        resolve();
      }
    });
  }

  // --- Data Loading ---
  async function loadWordsFromJSON(){
    try {
      const res = await fetch('./words.json', { cache: 'no-store' });
      if(!res.ok) throw new Error('failed');
      const data = await res.json();
      if(Array.isArray(data?.words) && data.words.length){
        state.words = data.words.map(x => ({ w: String(x.w), s: String(x.s || '') }));
        setLocal('spellstr.words', state.words);
      }
    } catch {
      // Fallback to defaults (likely file:// or offline first load)
      if(!state.words || !state.words.length){
        state.words = DEFAULT_WORDS.slice();
      }
    }
  }

  // --- State ---
  const state = {
    words: getLocal('spellstr.words', DEFAULT_WORDS),
    stats: getLocal('spellstr.stats', { correct: 0, attempts: 0 }),
    current: null,
    lastPrompt: '',
    mastered: new Set(), // unique words correctly spelled this session
    reviewQueue: [], // words to revisit after misses/skips
    sessionGoal: 20,
    lastW: null, // last word text shown
    tries: 0, // number of incorrect tries for current word
    mode: 'quiz', // 'quiz' | 'confirm' (confirm requires typing shown correct word)
  };

  function saveStats(){ setLocal('spellstr.stats', state.stats); }

  function updateStatsUI(){
    const {correct, attempts} = state.stats;
    $('#stats').textContent = `${correct} correct out of ${attempts} attempted`;
  }

  function queueMissed(wordObj){
    const key = wordObj.w.toLowerCase();
    if(state.mastered.has(key)) return; // don't queue mastered
    const exists = state.reviewQueue.some(x => x.w.toLowerCase() === key);
    if(!exists) state.reviewQueue.push({ w: wordObj.w, s: wordObj.s });
  }

  function pickWord(){
    if(!state.words.length){
      state.words = DEFAULT_WORDS.slice();
      setLocal('spellstr.words', state.words);
    }

    // Prefer revisiting missed words
    if(state.reviewQueue.length){
      let candidate = state.reviewQueue[0];
      if(candidate.w.toLowerCase() === (state.lastW || '').toLowerCase()){
        if(state.reviewQueue.length > 1){
          // rotate to avoid immediate repeat of the same word
          state.reviewQueue.push(state.reviewQueue.shift());
          candidate = state.reviewQueue[0];
        } else {
          candidate = null; // skip queue this round
        }
      }
      if(candidate){
        state.current = state.reviewQueue.shift();
        state.lastW = state.current.w.toLowerCase();
        return state.current;
      }
    }

    // Otherwise pick a random unmastered word, avoiding immediate repeat
    const pool = state.words.filter(x => !state.mastered.has(x.w.toLowerCase()) && x.w.toLowerCase() !== (state.lastW || ''));
    const source = pool.length ? pool : state.words.filter(x => x.w.toLowerCase() !== (state.lastW || ''));
    const pick = source.length ? source[Math.floor(Math.random() * source.length)] : state.words[0];
    state.current = pick;
    state.lastW = pick.w.toLowerCase();
    return state.current;
  }

  function promptCurrent(){
    if(!state.current) pickWord();
    const { w, s } = state.current;
    const text = `Spell ${w}, as in: \"${s}\"`;
    state.lastPrompt = text;
    $('#tts-hint').textContent = 'Listen to the word and example sentence.';
    return speak(text);
  }

  function feedbackOk(msg){
    const el = $('#feedback');
    el.className = 'feedback ok';
    el.textContent = msg;
  }
  function feedbackErr(msg){
    const el = $('#feedback');
    el.className = 'feedback err';
    el.textContent = msg;
  }
  function clearFeedback(){
    const el = $('#feedback');
    el.className = 'feedback';
    el.textContent = '';
  }

  // --- Flow ---
  function start(){
    $('#landing').classList.add('hidden');
    $('#practice').classList.remove('hidden');
    nextWord();
  }

  function nextWord(){
    pickWord();
    clearFeedback();
    state.tries = 0;
    state.mode = 'quiz';
    $('#answer').value = '';
    $('#answer').focus();
    promptCurrent();
  }

  function checkCelebration(){
    if(state.mastered.size >= state.sessionGoal){
      // Show celebration screen
      $('#practice').classList.add('hidden');
      $('#landing').classList.add('hidden');
      $('#celebrate').classList.remove('hidden');
      speak('Fantastic work! You spelled twenty words correctly!', { rate: 1.05 });
      return true;
    }
    return false;
  }

  function checkAnswer(input){
    const guess = (input || '').trim().toLowerCase();
    const correct = state.current.w.toLowerCase();

    // If we're in confirm mode, only accept the exact correct spelling to proceed.
    if(state.mode === 'confirm'){
      if(guess === correct){
        feedbackOk("Correct. Let's try the next word.");
        speak('Correct. Great job.', { rate: 1.05 });
        setTimeout(nextWord, 700);
      } else {
        feedbackErr(`Please type the correct spelling shown: "${state.current.w}".`);
        speak('Please type the correct spelling shown.', { rate: 0.95 });
        $('#answer').focus();
      }
      return;
    }

    // Quiz mode: allow up to 3 attempts.
    if(guess === correct){
      // Word completed correctly within attempts
      state.stats.attempts += 1;
      state.stats.correct += 1;
      // Mark as mastered (unique per session), and remove from review queue if present
      state.mastered.add(correct);
      state.reviewQueue = state.reviewQueue.filter(x => x.w.toLowerCase() !== correct);
      feedbackOk('Correct! Great job.');
      speak('Correct! Great job.', { rate: 1.05 });
      saveStats();
      updateStatsUI();
      if(!checkCelebration()){
        setTimeout(nextWord, 900);
      }
    } else {
      state.tries = (state.tries || 0) + 1;
      if(state.tries < 3){
        feedbackErr('Not quite. Try again.');
        speak('Not quite. Try again.', { rate: 0.95 });
        $('#answer').select();
      } else {
        // Third incorrect attempt: show correct spelling and require confirm typing.
        feedbackErr(`The correct spelling is "${state.current.w}". Please type it to continue.`);
        speak(`The correct spelling is ${state.current.w}. Please type it to continue.`, { rate: 0.95 });
        state.mode = 'confirm';
        // Count this word as attempted (incorrect). Do not increment correct.
        state.stats.attempts += 1;
        queueMissed(state.current);
        saveStats();
        updateStatsUI();
        $('#answer').value = '';
        $('#answer').focus();
      }
    }
  }

  // --- Events ---
  function bind(){
    $('#btn-start').addEventListener('click', start);
    $('#btn-hear').addEventListener('click', () => {
      if(state.lastPrompt) speak(state.lastPrompt); else promptCurrent();
    });
    $('#btn-skip').addEventListener('click', () => {
      feedbackErr('Skipped. Try the next word.');
      // Only count attempt if we haven't already counted this word (avoid double-count in confirm mode)
      if(state.mode !== 'confirm'){
        state.stats.attempts += 1; 
        queueMissed(state.current);
        saveStats(); updateStatsUI();
      }
      nextWord();
    });
    $('#btn-restart').addEventListener('click', () => {
      // Reset session-only data and return to landing
      state.mastered.clear();
      state.reviewQueue = [];
      state.tries = 0;
      state.mode = 'quiz';
      state.lastW = null;
      clearFeedback();
      $('#celebrate').classList.add('hidden');
      $('#practice').classList.add('hidden');
      $('#landing').classList.remove('hidden');
      $('#answer').value = '';
    });
    $('#answer-form').addEventListener('submit', (e) => {
      e.preventDefault();
      checkAnswer($('#answer').value);
    });

    // Restore stats on load
    updateStatsUI();
  }

  // --- PWA ---
  function registerSW(){
    if('serviceWorker' in navigator){
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
      });
    }
  }

  // --- Init ---
  function init(){
    setCookie('spellstr_visited', '1', 365);
    loadVoices();
    loadWordsFromJSON();
    bind();
    // Try preloading a first prompt so voices warm up on some browsers
    setTimeout(()=>{ /* no-op warmup */ }, 0);
  }

  init();
  registerSW();
})();
