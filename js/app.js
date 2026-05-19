const STORAGE_KEYS = {
    token: "fuwako.githubToken",
    lyrics: "fuwako.lyricsData",
};

const state = {
    tokenizer: null,
    grammar: [],
    words: {},
    lyrics: [],
    dict: {},
    currentLyric: null,
    aiPending: new Set(),
    aiLastTriggeredAt: 0,
    initialized: false,
    kuromojiLoading: false,
};

const $ = (id) => document.getElementById(id);

function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
    }[char]));
}

function isJapanese(text = "") {
    return /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

function normalizeArray(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
}

async function fetchJSON(path, fallback) {
    try {
        const response = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`${path} ${response.status}`);
        const text = await response.text();
        if (!text.trim()) return fallback;
        return JSON.parse(text);
    } catch (error) {
        console.warn(`无法读取 ${path}:`, error);
        return fallback;
    }
}

async function init() {
    if (state.initialized) return;
    state.initialized = true;
    loadSavedConfig();
    const [grammarData, wordsData, lyricsData, dictData] = await Promise.all([
        fetchJSON("grammar.json", []),
        fetchJSON("words.json", {}),
        fetchJSON("lyrics_data.json", []),
        fetchJSON("dict.json", {}),
    ]);

    state.grammar = normalizeArray(grammarData);
    state.words = wordsData && typeof wordsData === "object" && !Array.isArray(wordsData) ? wordsData : {};
    state.dict = dictData && typeof dictData === "object" && !Array.isArray(dictData) ? dictData : {};
    state.lyrics = mergeLyrics(readLocalLyrics(), normalizeArray(lyricsData));
    state.lyrics = await pullLyricsFromGitHub(state.lyrics);
    writeLocalLyrics();

    renderGrammar();
    renderLyrics();
    refreshAdminState();
    bindUIActions();
    switchTab("grammar");
    initKuromoji();
}

function initKuromoji() {
    if (state.tokenizer || state.kuromojiLoading) return;

    const bar = $("loading-bar");
    const text = $("loading-text");

    if (!window.kuromoji) {
        hideLoadingMask("页面已可使用，分词词典继续后台加载...");
        return;
    }

    state.kuromojiLoading = true;
    let percent = 8;
    let settled = false;
    const timer = setInterval(() => {
        percent = Math.min(92, percent + 7);
        if (bar) bar.style.width = `${percent}%`;
        if (text) text.innerText = `正在加载词典... ${percent}%`;
    }, 180);
    const failSafe = setTimeout(() => {
        if (settled) return;
        settled = true;
        state.kuromojiLoading = false;
        clearInterval(timer);
        hideLoadingMask("词典加载较慢，已先进入页面");
    }, 8000);

    kuromoji.builder({ dicPath: "dict/" }).build((err, tokenizer) => {
        if (settled) return;
        settled = true;
        state.kuromojiLoading = false;
        clearInterval(timer);
        clearTimeout(failSafe);
        if (err) {
            console.warn("Kuromoji 词典加载失败:", err);
            hideLoadingMask("词典加载失败，基础功能仍可使用");
            return;
        }
        state.tokenizer = tokenizer;
        hideLoadingMask("词典加载完成！");
        if (state.currentLyric) renderDetail(state.currentLyric.id);
    });
}

function hideLoadingMask(message) {
    const bar = $("loading-bar");
    const text = $("loading-text");
    const mask = $("loading-mask");
    if (bar) bar.style.width = "100%";
    if (text) text.innerText = message;
    if (mask) {
        setTimeout(() => {
            mask.classList.add("loading-mask-hidden");
            mask.style.pointerEvents = "none";
        }, 450);
    }
}

function switchTab(tab) {
    document.querySelectorAll(".view-section").forEach((section) => section.classList.add("hidden"));
    document.querySelectorAll(".tab-btn").forEach((button) => button.classList.remove("tab-btn-active"));

    const target = $(`view-${tab}`);
    if (target) target.classList.remove("hidden");

    const tabButton = $(`tab-${tab}`);
    if (tabButton) tabButton.classList.add("tab-btn-active");

    if (tab === "lyrics") renderLyrics();
    if (tab === "grammar") renderGrammar();
}

function renderGrammar() {
    const list = $("grammar-list");
    if (!list) return;

    const grammarCards = state.grammar.map((item) => {
        const title = item.t || item.title || item.name || "语法项目";
        const category = item.c || item.category || "Grammar";
        const lines = String(item.l || item.content || item.desc || "")
            .split("\n")
            .filter(Boolean)
            .map((line) => `<li class="leading-6">${escapeHTML(line)}</li>`)
            .join("");
        return `
            <article class="glass hover-scale p-5 shadow-sm">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="font-bold text-gray-700">${escapeHTML(title)}</h3>
                    <span class="text-[10px] px-2 py-1 rounded-full bg-pink-100/80 text-pink-500">${escapeHTML(category)}</span>
                </div>
                <ul class="text-xs text-gray-600 space-y-1 list-disc pl-4">${lines || "<li>暂无说明</li>"}</ul>
            </article>`;
    });

    const wordEntries = Object.entries(state.words);
    const wordsCard = `
        <article class="glass hover-scale p-5 shadow-sm md:col-span-2">
            <div class="flex items-center justify-between mb-3">
                <h3 class="font-bold text-gray-700">words.json 词库</h3>
                <span class="text-[10px] px-2 py-1 rounded-full bg-blue-100/80 text-blue-500">${wordEntries.length} entries</span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-80 overflow-auto pr-1">
                ${wordEntries.length ? wordEntries.map(([word, meaning]) => `
                    <div class="rounded-2xl bg-white/45 p-3 text-xs">
                        <span class="font-bold text-pink-500">${escapeHTML(word)}</span>
                        <span class="text-gray-500 ml-2">${escapeHTML(meaning)}</span>
                    </div>`).join("") : "<p class='text-xs text-gray-400 italic'>words.json 目前为空或不是键值对象；已继续显示 grammar.json。</p>"}
            </div>
        </article>`;

    list.innerHTML = [...grammarCards, wordsCard].join("") || wordsCard;
}

function readLocalLyrics() {
    try {
        return normalizeArray(JSON.parse(localStorage.getItem(STORAGE_KEYS.lyrics) || "[]"));
    } catch {
        return [];
    }
}

function writeLocalLyrics() {
    localStorage.setItem(STORAGE_KEYS.lyrics, JSON.stringify(state.lyrics));
}

function mergeLyrics(localItems, remoteItems) {
    const map = new Map();
    [...remoteItems, ...localItems].forEach((item) => {
        if (!item || !item.id) return;
        const previous = map.get(item.id);
        if (!previous || Number(item.timestamp || 0) >= Number(previous.timestamp || 0)) {
            map.set(item.id, normalizeLyric(item));
        }
    });
    return [...map.values()].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

function normalizeLyric(item) {
    const text = Array.isArray(item.text) ? item.text : String(item.text || "").split("\n");
    const analysis = Array.isArray(item.analysis) ? item.analysis : [];
    return {
        id: item.id || Date.now(),
        title: item.title || "未命名歌曲",
        text,
        timestamp: item.timestamp || Date.now(),
        analysis: text.map((line, index) => isJapanese(line) ? (analysis[index] || null) : null),
    };
}

function renderLyrics() {
    const container = $("lyrics-container");
    if (!container) return;
    if (!state.lyrics.length) {
        container.innerHTML = "<div class='glass p-6 text-center text-sm text-gray-400'>lyrics_data.json 暂无歌词。</div>";
        return;
    }
    container.innerHTML = state.lyrics.map((lyric) => `
        <button type="button" onclick="openLyric(${Number(lyric.id)})" class="glass hover-scale w-full text-left p-5 shadow-sm block">
            <div class="flex items-center justify-between gap-3">
                <h3 class="font-bold text-gray-700">${escapeHTML(lyric.title)}</h3>
                <span class="text-[10px] text-gray-400">${new Date(Number(lyric.timestamp || lyric.id)).toLocaleString()}</span>
            </div>
            <p class="text-xs text-gray-500 mt-2 line-clamp-2">${escapeHTML((lyric.text || []).slice(0, 2).join(" / "))}</p>
        </button>`).join("");
}

function openLyric(id) {
    renderDetail(id);
    switchTab("detail");
}

function renderDetail(id) {
    const lyric = state.lyrics.find((item) => Number(item.id) === Number(id));
    if (!lyric) return;
    state.currentLyric = lyric;
    $("detail-title").innerText = lyric.title;
    const content = $("detail-content");
    content.innerHTML = lyric.text.map((line, index) => {
        const japanese = isJapanese(line);
        const tokens = japanese ? tokenizeLine(line) : escapeHTML(line);
        const button = japanese ? `<button type="button" onclick="showLineAnalysis(${index})" class="ml-2 align-middle px-2 py-0.5 rounded-full bg-white/60 text-[10px] text-pink-500 font-bold hover:bg-pink-100">查看解析</button>` : "";
        return `<div class="rounded-2xl bg-white/35 p-3"><div>${tokens}${button}</div></div>`;
    }).join("");
}

function tokenizeLine(line) {
    if (!state.tokenizer) return escapeHTML(line);
    return state.tokenizer.tokenize(line).map((token) => {
        const surface = token.surface_form;
        const className = posClass(token.pos);
        return `<button type="button" onclick="showWord('${encodeURIComponent(surface)}')" class="word-token ${className}">${escapeHTML(surface)}</button>`;
    }).join("");
}

function posClass(pos) {
    if (pos === "動詞") return "pos-verb";
    if (pos === "助詞") return "pos-particle";
    if (pos === "形容詞" || pos === "形容動詞語幹") return "pos-adj";
    if (pos === "名詞") return "pos-noun";
    return "";
}

function showWord(encodedWord) {
    const word = decodeURIComponent(encodedWord);
    const meaning = state.dict[word] || state.words[word];
    $("dict-result").innerHTML = meaning
        ? `<div class="font-bold text-gray-700 mb-1">${escapeHTML(word)}</div><div>${escapeHTML(meaning)}</div>`
        : `<div class="font-bold text-gray-700 mb-1">${escapeHTML(word)}</div><div class="italic text-gray-400">未收录</div>`;
}

function showLineAnalysis(index) {
    const lyric = state.currentLyric;
    if (!lyric) return;
    const item = lyric.analysis && lyric.analysis[index];
    $("ai-result").innerHTML = item
        ? `<p class="font-bold text-gray-700 mb-2">${escapeHTML(item.translation || "")}</p><p>${escapeHTML(item.grammar || "")}</p>`
        : "<span class='italic text-gray-400'>这一句还没有 AI 解析，可点击顶部 AI 语法解析生成。</span>";
}


function bindUIActions() {
    const saveBtn = document.querySelector('[data-action="save-config"]');
    if (saveBtn && !saveBtn.dataset.bound) {
        saveBtn.dataset.bound = "1";
        saveBtn.addEventListener("click", (event) => {
            event.preventDefault();
            saveConfig();
        });
    }

    const configBtn = document.querySelector('[data-action="toggle-config"]');
    if (configBtn && !configBtn.dataset.bound) {
        configBtn.dataset.bound = "1";
        configBtn.addEventListener("click", (event) => {
            event.preventDefault();
            toggleConfig();
        });
    }
}

function toggleConfig() {
    const modal = $("config-modal");
    modal.classList.toggle("hidden");
    if (!modal.classList.contains("hidden")) loadSavedConfig();
}

function loadSavedConfig() {
    const token = localStorage.getItem(STORAGE_KEYS.token) || "";
    if ($("gh-token")) $("gh-token").value = token;
}

function saveConfig() {
    const tokenInput = $("gh-token");
    if (!tokenInput) {
        alert("未找到 Token 输入框，请刷新页面后重试。");
        return;
    }
    localStorage.setItem(STORAGE_KEYS.token, tokenInput.value.trim());
    refreshAdminState();
    toggleConfig();
    alert(localStorage.getItem(STORAGE_KEYS.token) ? "配置已保存：已连接 GitHub，可上传歌词。" : "配置已保存：未填写 Token，将以游客模式浏览。");
}

function refreshAdminState() {
    const area = $("admin-add-area");
    const hint = $("token-hint");
    const button = $("add-lyrics-btn");
    const aiButton = $("trigger-ai-btn");
    if (area) area.classList.remove("hidden");

    const hasToken = Boolean((localStorage.getItem(STORAGE_KEYS.token) || "").trim());
    if (hint) {
        hint.className = hasToken ? "mt-2 text-[11px] text-emerald-500" : "mt-2 text-[11px] text-amber-500";
        hint.innerText = hasToken
            ? "已检测到 GitHub Token，提交后会静默同步至云端 lyrics_data.json。"
            : "请先配置 GitHub Token，提交后才会写入云端 lyrics_data.json。";
    }
    if (button) {
        button.disabled = !hasToken;
        button.classList.toggle("opacity-50", !hasToken);
        button.classList.toggle("cursor-not-allowed", !hasToken);
    }
    if (aiButton) {
        aiButton.disabled = false;
        aiButton.classList.toggle("opacity-80", !hasToken);
        aiButton.classList.remove("cursor-not-allowed");
        aiButton.title = hasToken ? "" : "游客模式可查看已有解析；AI 语法解析需先配置 GitHub Token";
    }
}

function addLyrics() {
    const token = localStorage.getItem(STORAGE_KEYS.token);
    if (!token) {
        alert("请先点击右上角 7.png 图标配置 GitHub Token，游客模式不能上传。");
        return;
    }
    const title = $("new-lyric-title").value.trim();
    const text = $("new-lyric-text").value.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!title || !text.length) {
        alert("请填写歌曲标题和歌词内容。");
        return;
    }
    const now = Date.now();
    const lyric = normalizeLyric({ id: now, title, text, timestamp: now, analysis: [] });
    state.lyrics = mergeLyrics([lyric], state.lyrics);
    writeLocalLyrics();
    renderLyrics();
    $("new-lyric-title").value = "";
    $("new-lyric-text").value = "";
    syncLyricsToGitHub().catch((error) => console.warn("静默推送失败:", error));
}

async function syncLyricsToGitHub() {
    const token = localStorage.getItem(STORAGE_KEYS.token);
    const repo = "Ancenchan/fuwako";
    const branch = "main";
    if (!token) throw new Error("缺少 GitHub Token");

    const url = `https://api.github.com/repos/${repo}/contents/lyrics_data.json?ref=${encodeURIComponent(branch)}`;
    const current = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    if (!current.ok) throw new Error(`读取云端歌词失败: ${current.status}`);
    const meta = await current.json();
    const body = {
        message: "Update lyrics data from Fuwako",
        content: btoa(unescape(encodeURIComponent(JSON.stringify(state.lyrics, null, 2)))),
        sha: meta.sha,
        branch,
    };
    const response = await fetch(`https://api.github.com/repos/${repo}/contents/lyrics_data.json`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`更新云端歌词失败: ${response.status}`);
}


async function pullLyricsFromGitHub(fallbackLyrics = state.lyrics) {
    const token = localStorage.getItem(STORAGE_KEYS.token);
    if (!token) return fallbackLyrics;
    try {
        const repo = "Ancenchan/fuwako";
        const branch = "main";
        const response = await fetch(`https://api.github.com/repos/${repo}/contents/lyrics_data.json?ref=${encodeURIComponent(branch)}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        });
        if (!response.ok) throw new Error(`读取云端歌词失败: ${response.status}`);
        const meta = await response.json();
        const decoded = decodeURIComponent(escape(atob((meta.content || "").replace(/\n/g, ""))));
        const cloudLyrics = normalizeArray(JSON.parse(decoded || "[]"));
        return mergeLyrics(fallbackLyrics, cloudLyrics);
    } catch (error) {
        console.warn("拉取云端歌词失败:", error);
        return fallbackLyrics;
    }
}

async function triggerAI() {
    const lyric = state.currentLyric;
    if (!lyric) return;
    const token = (localStorage.getItem(STORAGE_KEYS.token) || "").trim();
    if (!token) {
        alert("当前是游客模式：可点击每句右侧【查看解析】查看已有内容；如需重新生成 AI 语法解析，请先配置 GitHub Token。");
        return;
    }
    if ((lyric.analysis || []).some((item, index) => isJapanese(lyric.text[index]) && item)) {
        alert("已存在解析结果，可直接点击每行旁边的“解析”。");
        return;
    }
    if (state.aiPending.has(lyric.id)) return;
    const now = Date.now();
    if (now - state.aiLastTriggeredAt < 60000) {
        alert("AI 讲解一分钟只能触发一次，请稍后再试。");
        return;
    }
    const apiKey = prompt("请输入 OpenRouter API Key");
    if (!apiKey) return;

    state.aiPending.add(lyric.id);
    $("ai-progress-wrap").classList.remove("hidden");
    $("ai-progress-bar").style.width = "15%";
    try {
        const linesForAI = lyric.text.map((line) => isJapanese(line) ? line : null);
        const promptText = `你是一个专业的日语老师。解析以下日语歌词，强制返回单句翻译和语法点(含每个单词的性质和翻译/是否有变形/连接词作用/句式)，格式 [{"translation":"单句翻译","grammar":"语法点"},null]。严禁包含任何说明文字、Markdown格式或换行符。必须使用双引号包裹属性和字符串，解析内容中如需引号请使用单引号。非日文行必须返回null。待解析数组：${JSON.stringify(linesForAI)}`;
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "z-ai/glm-4.5-air:free",
                messages: [{ role: "user", content: promptText }],
                temperature: 0.2,
            }),
        });
        $("ai-progress-bar").style.width = "70%";
        if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "[]";
        lyric.analysis = JSON.parse(content).map((item, index) => isJapanese(lyric.text[index]) ? item : null);
        state.aiLastTriggeredAt = Date.now();
        lyric.timestamp = Date.now();
        state.lyrics = mergeLyrics([lyric], state.lyrics);
        writeLocalLyrics();
        $("ai-progress-bar").style.width = "100%";
        if (localStorage.getItem(STORAGE_KEYS.token)) syncLyricsToGitHub().catch((error) => console.warn("AI 解析静默推送失败:", error));
        alert("AI 解析完成，请点击行旁“查看解析”查看。保存配置后会同步到 GitHub。 ");
    } catch (error) {
        console.error(error);
        alert(`AI 解析失败：${error.message}`);
    } finally {
        state.aiPending.delete(lyric.id);
        setTimeout(() => $("ai-progress-wrap").classList.add("hidden"), 800);
    }
}

window.switchTab = switchTab;
window.openLyric = openLyric;
window.showWord = showWord;
window.showLineAnalysis = showLineAnalysis;
window.toggleConfig = toggleConfig;
window.saveConfig = saveConfig;
window.addLyrics = addLyrics;
window.triggerAI = triggerAI;
window.fuwakoInitKuromoji = initKuromoji;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init().catch((error) => {
        console.error("Fuwako 初始化失败:", error);
        hideLoadingMask("初始化失败，请刷新重试");
    }));
} else {
    init().catch((error) => {
        console.error("Fuwako 初始化失败:", error);
        hideLoadingMask("初始化失败，请刷新重试");
    });
}
