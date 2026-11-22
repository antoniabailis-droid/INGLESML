(() => {
  "use strict";

  const BLOCKS = window.BLOCKS;
  if (!Array.isArray(BLOCKS) || BLOCKS.length !== 25 || BLOCKS.some(b => !Array.isArray(b.cards) || b.cards.length !== 10)) {
    document.body.innerHTML = "<p style='padding:24px;font-family:Arial'>Error: no se han podido cargar los 25 bloques de INGLES ML.</p>";
    throw new Error("Contenido de INGLES ML incompleto: se requieren 25 bloques de 10 tarjetas.");
  }

  const $ = id => document.getElementById(id);
  const STORAGE_KEY = "inglesML_progress_v2";
  const LEGACY_KEYS = ["inglesML_progress_v1", "ingles_ml_progress_v1"];
  const screens = ["homeScreen", "blocksScreen", "practiceScreen", "completeScreen"];
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  let progress = loadProgress();
  let blockIndex = 0;
  let cardIndex = 0;
  let correctCount = 0;
  let active = false;
  let listening = false;
  let speaking = false;
  let processing = false;
  let recognition = null;
  let session = 0;
  let reviewMode = false;

  function emptyProgress() {
    return { blocks: {}, lastBlock: 0, lastCard: 0 };
  }

  function loadProgress() {
    let saved = null;
    let sourceKey = STORAGE_KEY;
    for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) { saved = JSON.parse(raw); sourceKey = key; break; }
      } catch (error) { console.warn("No se pudo leer el progreso guardado:", error); }
    }
    const result = emptyProgress();
    if (!saved || typeof saved !== "object") return result;

    // Formato actual y formato de la primera versión de INGLES ML.
    if (saved.blocks && typeof saved.blocks === "object") {
      for (const [id, item] of Object.entries(saved.blocks)) {
        // La primera versión guardaba los bloques con índice 0–24; la actual usa 1–25.
        const blockId = sourceKey === "ingles_ml_progress_v1" ? String(Number(id) + 1) : String(id);
        const completed = Array.isArray(item?.completedCards)
          ? item.completedCards.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < 10)
          : Object.entries(item?.completedCards || {}).filter(([, count]) => Number(count) >= 5).map(([n]) => Number(n));
        result.blocks[blockId] = { completedCards: [...new Set(completed)], currentCard: Math.max(0, Math.min(9, Number(item?.currentCard) || 0)) };
      }
      result.lastBlock = Math.max(0, Math.min(24, Number(saved.lastBlock) || 0));
      result.lastCard = Math.max(0, Math.min(9, Number(saved.lastCard) || 0));
    } else {
      // Migración del ZIP inicial: completed era una lista de bloques y counts guardaba aciertos.
      if (Array.isArray(saved.completed)) {
        saved.completed.forEach(index => {
          const id = String(Number(index) + 1);
          result.blocks[id] = { completedCards: Array.from({length:10}, (_,i)=>i), currentCard: 0 };
        });
      }
      if (saved.counts && typeof saved.counts === "object") {
        for (const [key, value] of Object.entries(saved.counts)) {
          const id = String(Number(key) + 1);
          const completedCards = Object.entries(value || {}).filter(([,n]) => Number(n) >= 5).map(([n]) => Number(n));
          if (completedCards.length) result.blocks[id] = { completedCards, currentCard: 0 };
        }
      }
      result.lastBlock = Math.max(0, Math.min(24, Number(saved.lastBlock) || 0));
      result.lastCard = Math.max(0, Math.min(9, Number(saved.lastCard) || 0));
    }
    return result;
  }

  function saveProgress() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); }
    catch (error) { console.warn("No se pudo guardar el progreso:", error); }
  }

  function blockProgress(index) {
    const id = String(index + 1);
    if (!progress.blocks[id]) progress.blocks[id] = { completedCards: [], currentCard: 0 };
    return progress.blocks[id];
  }

  function totalCompletedCards() {
    return Object.values(progress.blocks).reduce((sum, item) => sum + (item.completedCards || []).length, 0);
  }

  function completedBlocks() {
    return BLOCKS.filter((_, i) => blockProgress(i).completedCards.length === 10).length;
  }

  function showScreen(id) {
    screens.forEach(screenId => {
      const el = $(screenId);
      el.hidden = screenId !== id;
      el.classList.toggle("active", screenId === id);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderGlobalProgress() {
    const total = totalCompletedCards();
    const percent = Math.round(total / 250 * 100);
    $("overallPercent").textContent = `${percent}%`;
    $("overallBar").style.width = `${percent}%`;
    $("overallText").textContent = `${total} de 250 tarjetas`;
    $("completedCardsHome").textContent = `${total} / 250`;
    $("completedBlocksHome").textContent = `${completedBlocks()} / 25`;
  }

  function renderHome() {
    renderGlobalProgress();
    const last = Math.max(0, Math.min(24, Number(progress.lastBlock) || 0));
    const data = blockProgress(last);
    const nextCard = data.completedCards.includes(progress.lastCard) ? Math.min(9, progress.lastCard + 1) : progress.lastCard;
    $("continueButton").textContent = totalCompletedCards() ? "CONTINUAR" : "COMENZAR";
    $("continueButton").dataset.block = String(last);
    $("continueButton").dataset.card = String(nextCard);
  }

  function renderBlocks() {
    const grid = $("blocksGrid");
    grid.innerHTML = "";
    BLOCKS.forEach((item, i) => {
      const data = blockProgress(i);
      const done = data.completedCards.length === 10;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `block-card${done ? " completed" : ""}`;
      const number = document.createElement("span");
      number.className = "block-number";
      number.textContent = `BLOQUE ${String(i + 1).padStart(2, "0")}${done ? " ✓" : ""}`;
      const title = document.createElement("strong");
      title.textContent = item.title;
      const status = document.createElement("span");
      status.className = "block-status";
      status.textContent = done ? "Completado · Puedes repasarlo" : `${data.completedCards.length} / 10 tarjetas completadas`;
      button.append(number, title, status);
      button.addEventListener("click", () => {
        const start = done ? 0 : Math.min(data.currentCard || 0, 9);
        startBlock(i, start, done);
      });
      grid.appendChild(button);
    });
  }

  function currentBlock() { return BLOCKS[blockIndex]; }
  function currentCard() {
    const raw = currentBlock().cards[cardIndex];
    return Array.isArray(raw) ? { prompt: raw[0], answer: raw[1], pronunciation: raw[2] || "", reference: raw[3] || "" } : raw;
  }

  function startBlock(index, startCard = 0, isReview = false) {
    stopPractice(false);
    blockIndex = Math.max(0, Math.min(24, index));
    cardIndex = Math.max(0, Math.min(9, startCard));
    correctCount = 0;
    reviewMode = Boolean(isReview);
    const data = blockProgress(blockIndex);
    data.currentCard = cardIndex;
    progress.lastBlock = blockIndex;
    progress.lastCard = cardIndex;
    saveProgress();
    renderCard();
    showScreen("practiceScreen");
  }

  function renderCard() {
    const b = currentBlock();
    const c = currentCard();
    $("blockLabel").textContent = `BLOQUE ${blockIndex + 1} · ${b.title}`;
    $("blockDescription").textContent = b.description || "Practica esta estructura en inglés.";
    $("cardLabel").textContent = `Tarjeta ${cardIndex + 1} de 10`;
    $("promptText").textContent = c.prompt.replace(/^(Diga:|Di:|Pregunte:|Pregunta:|Pida:|Pide:)\s*/i, "");
    $("answerText").textContent = c.answer;
    $("visualGuideText").textContent = c.answer;
    $("pronunciationText").textContent = c.pronunciation ? `(${c.pronunciation})` : "Pronunciación británica";
    $("verbReference").textContent = c.reference ? `Referencia: ${c.reference}` : (c.verb ? `Referencia: ${c.verb}` : (c.infinitive ? `Verbo: ${c.infinitive}` : ""));
    $("correctCounter").textContent = `${correctCount} / 5`;
    $("feedback").textContent = active ? "Preparando la frase…" : "Pulsa READY para comenzar.";
    $("feedback").className = "feedback";
    $("heardText").textContent = "";
    const dots = $("cardDots");
    dots.innerHTML = "";
    for (let i = 0; i < 10; i++) {
      const dot = document.createElement("span");
      dot.className = `card-dot${i === cardIndex ? " active" : ""}${blockProgress(blockIndex).completedCards.includes(i) ? " done" : ""}`;
      dots.appendChild(dot);
    }
    renderGlobalProgress();
  }

  function setFeedback(message, kind = "") {
    $("feedback").textContent = message;
    $("feedback").className = `feedback${kind ? ` ${kind}` : ""}`;
  }

  function speak(text, rate = 0.88, token = session) {
    return new Promise(resolve => {
      if (token !== session) return resolve();
      if (!("speechSynthesis" in window) || !text) return resolve();
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-GB";
      utterance.rate = rate;
      utterance.pitch = 1;
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(v => /^en-GB/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang));
      if (voice) utterance.voice = voice;
      speaking = true;
      utterance.onend = utterance.onerror = () => {
        if (token === session) speaking = false;
        resolve();
      };
      try { window.speechSynthesis.speak(utterance); }
      catch (error) { speaking = false; console.warn(error); resolve(); }
    });
  }

  function normalize(text) {
    return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[.,!?;:'’"¿¡]/g, "").replace(/\b(i'm)\b/g, "i am")
      .replace(/\b(he's)\b/g, "he is").replace(/\b(she's)\b/g, "she is")
      .replace(/\b(we're)\b/g, "we are").replace(/\b(they're)\b/g, "they are")
      .replace(/\b(don't)\b/g, "do not").replace(/\b(doesn't)\b/g, "does not")
      .replace(/\b(didn't)\b/g, "did not").replace(/\b(can't)\b/g, "cannot")
      .replace(/\s+/g, " ").trim();
  }

  function similarity(a, b) {
    const x = normalize(a).split(" ").filter(Boolean);
    const y = normalize(b).split(" ").filter(Boolean);
    if (!x.length || !y.length) return 0;
    const dp = Array.from({ length: x.length + 1 }, (_, i) => {
      const row = Array(y.length + 1).fill(0); row[0] = i; return row;
    });
    for (let j = 0; j <= y.length; j++) dp[0][j] = j;
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) {
      dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (x[i-1] === y[j-1] ? 0 : 1));
    }
    return 1 - dp[x.length][y.length] / Math.max(x.length, y.length);
  }

  function isRepeatCommand(text) {
    return ["repeat", "repite", "again", "say it again", "once again"].includes(normalize(text));
  }

  function createRecognition() {
    if (!SpeechRecognition) {
      setFeedback("Este navegador no admite reconocimiento de voz. Abre INGLES ML en Chrome.", "bad");
      return null;
    }
    const rec = new SpeechRecognition();
    rec.lang = "en-GB";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 4;
    rec.onstart = () => { listening = true; setFeedback("Te escucho. Repite la frase en inglés."); };
    rec.onresult = event => {
      const result = event.results[event.resultIndex];
      const alternatives = Array.from(result || []).map(item => item.transcript || "");
      const transcript = alternatives[0] || "";
      handleResult(alternatives, transcript);
    };
    rec.onerror = event => {
      listening = false;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        active = false;
        setFeedback("Permite el acceso al micrófono para practicar.", "bad");
      } else if (event.error === "no-speech") {
        setFeedback("No he escuchado nada. Vuelve a intentarlo.");
      } else if (event.error !== "aborted") {
        setFeedback("No he podido reconocer la voz. Inténtalo otra vez.", "bad");
      }
    };
    rec.onend = () => {
      listening = false;
      if (active && !speaking && !processing) {
        window.setTimeout(() => { if (active && !speaking && !processing) startListening(); }, 300);
      }
    };
    return rec;
  }

  function startListening() {
    if (!active || listening || speaking || processing) return;
    if (!recognition) recognition = createRecognition();
    if (!recognition) return;
    try { recognition.start(); }
    catch (error) {
      console.warn("No se pudo iniciar el micrófono:", error);
      window.setTimeout(() => { if (active && !listening && !speaking && !processing) startListening(); }, 500);
    }
  }

  async function speakThenListen(rate = 0.88) {
    if (!active) return;
    const token = session;
    const phrase = currentCard().answer;
    setFeedback("Escucha la frase en inglés…");
    await speak(phrase, rate, token);
    if (active && token === session) startListening();
  }

  async function handleResult(alternatives, transcript) {
    if (!active || processing) return;
    processing = true;
    $("heardText").textContent = `La aplicación entendió: ${transcript}`;
    if (alternatives.some(isRepeatCommand)) {
      setFeedback("Repitiendo la frase, más despacio…");
      await speak(currentCard().answer, 0.72, session);
      processing = false;
      if (active) startListening();
      return;
    }
    const expected = currentCard().answer;
    const score = Math.max(0, ...alternatives.map(value => similarity(value, expected)));
    if (score >= 0.86) {
      correctCount++;
      $("correctCounter").textContent = `${correctCount} / 5`;
      setFeedback(`¡Correcto! ${correctCount} de 5.`, "good");
      if (correctCount >= 5) {
        const token = session;
        markCardComplete();
        await speak("Very good", 0.95, token);
        processing = false;
        if (active && token === session) advanceCard();
      } else {
        await speak("Correct. Again, please.", 0.95, session);
        processing = false;
        if (active) speakThenListen(0.88);
      }
    } else {
      setFeedback("No cuenta. Vuelve a repetir la frase.", "bad");
      await speak("Try again, please.", 0.95, session);
      processing = false;
      if (active) speakThenListen(0.88);
    }
  }

  function markCardComplete() {
    const data = blockProgress(blockIndex);
    if (!data.completedCards.includes(cardIndex)) data.completedCards.push(cardIndex);
    data.completedCards.sort((a,b) => a-b);
    data.currentCard = Math.min(9, cardIndex + 1);
    progress.lastBlock = blockIndex;
    progress.lastCard = cardIndex < 9 ? cardIndex + 1 : 0;
    saveProgress();
    renderGlobalProgress();
  }

  function advanceCard() {
    if (!active) return;
    if (cardIndex < 9) {
      cardIndex++;
      correctCount = 0;
      blockProgress(blockIndex).currentCard = cardIndex;
      progress.lastBlock = blockIndex;
      progress.lastCard = cardIndex;
      saveProgress();
      renderCard();
      speakThenListen(0.88);
    } else {
      finishBlock();
    }
  }

  function finishBlock() {
    active = false;
    stopRecognitionOnly();
    const data = blockProgress(blockIndex);
    data.completedCards = Array.from({ length: 10 }, (_, i) => i);
    data.currentCard = 0;
    progress.lastBlock = blockIndex < 24 ? blockIndex + 1 : 24;
    progress.lastCard = 0;
    saveProgress();
    renderGlobalProgress();
    $("completeTitle").textContent = `¡Bloque ${blockIndex + 1} completado!`;
    $("completeMessage").textContent = `Has completado las diez tarjetas de “${currentBlock().title}”.`;
    $("nextBlockButton").hidden = blockIndex >= 24;
    showScreen("completeScreen");
  }

  function stopRecognitionOnly() {
    if (recognition && listening) {
      try { recognition.abort(); } catch (error) { console.warn(error); }
    }
    listening = false;
  }

  function stopPractice(showMessage = true) {
    active = false;
    processing = false;
    speaking = false;
    session++;
    stopRecognitionOnly();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (showMessage && $("feedback")) setFeedback("Práctica detenida.");
  }

  async function readyPractice() {
    if (active) return;
    if (!SpeechRecognition) {
      setFeedback("Tu navegador no permite reconocimiento de voz. Utiliza Chrome.", "bad");
      return;
    }
    active = true;
    processing = false;
    session++;
    await speakThenListen(0.88);
  }

  async function repeatPhrase() {
    const wasActive = active;
    if (recognition && listening) stopRecognitionOnly();
    const token = session;
    await speak(currentCard().answer, 0.72, token);
    if (wasActive && active && token === session) startListening();
  }

  function goHome() {
    stopPractice(false);
    renderHome();
    showScreen("homeScreen");
  }

  function goBlocks() {
    stopPractice(false);
    renderBlocks();
    showScreen("blocksScreen");
  }

  $("continueButton").addEventListener("click", () => {
    const i = Number($("continueButton").dataset.block || 0);
    const c = Number($("continueButton").dataset.card || 0);
    startBlock(i, c, false);
  });
  $("chooseBlockButton").addEventListener("click", goBlocks);
  $("blocksHomeButton").addEventListener("click", goHome);
  $("homeButton").addEventListener("click", goHome);
  $("blocksButton").addEventListener("click", goBlocks);
  $("readyButton").addEventListener("click", readyPractice);
  $("repeatButton").addEventListener("click", repeatPhrase);
  $("listenPhraseButton").addEventListener("click", () => speak(currentCard().answer, 0.88, session));
  $("stopButton").addEventListener("click", () => stopPractice(true));
  $("nextBlockButton").addEventListener("click", () => startBlock(Math.min(24, blockIndex + 1), 0, false));
  $("reviewBlockButton").addEventListener("click", () => startBlock(blockIndex, 0, true));
  $("completeHomeButton").addEventListener("click", goHome);

  window.addEventListener("beforeunload", () => {
    if (blockIndex >= 0 && blockIndex < 25) {
      const data = blockProgress(blockIndex);
      data.currentCard = cardIndex;
      progress.lastBlock = blockIndex;
      progress.lastCard = cardIndex;
      saveProgress();
    }
  });

  renderHome();
  renderBlocks();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(error => console.warn("Service worker:", error)));
  }
  console.info(`INGLES ML iniciado: ${BLOCKS.length} bloques, ${BLOCKS.reduce((n,b)=>n+b.cards.length,0)} tarjetas.`);
})();
