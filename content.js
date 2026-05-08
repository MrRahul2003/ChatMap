(function () {
    'use strict';

    if (document.getElementById('gemini-nav-panel')) {
        return;
    }

    const DEBOUNCE_MS = 1500;
    const PREVIEW_LIMIT = 86;
    const POSITION_STORAGE_KEY = 'gpm-panel-position-v1';

    let isMinimized = false;
    let activePromptIndex = -1;
    let promptNodes = [];
    let refreshTimer = null;
    let scrollTicking = false;
    const selectedIndices = new Set();
    const dragState = {
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0
    };

    const panel = document.createElement('aside');
    panel.id = 'gemini-nav-panel';
    panel.setAttribute('aria-label', 'Gemini Pro Manager');
    panel.innerHTML = [
        '<div id="gpm-header">',
        '  <div id="gpm-title-wrap">',
        '    <span id="gpm-title">ChatMap</span>',
        '    <span id="gpm-count">0 prompts</span>',
        '  </div>',
          '  <div id="gpm-header-controls">',
          '    <button id="gpm-refresh" type="button" title="Refresh prompts" aria-label="Refresh prompts">↻</button>',
          '    <button id="gpm-toggle" type="button" title="Minimize panel" aria-label="Minimize panel">−</button>',
          '  </div>',
        '</div>',
        '<div id="gpm-action-bar">',
        '  <div id="gpm-action-top">',
        '    <div id="gpm-tabs">',
        '      <button class="gpm-tab gpm-tab--active" id="gpm-tab-all">All</button>',
        '      <button class="gpm-tab" id="gpm-tab-fav">Favorites</button>',
        '    </div>',
        '  </div>',
        '  <div id="gpm-actions-row">',
        '    <button class="gpm-btn" id="gpm-btn-summary" type="button">Summarize</button>',
        '    <button class="gpm-btn" id="gpm-btn-copy" type="button">Copy</button>',
        '    <button class="gpm-btn" id="gpm-btn-pdf" type="button">Export PDF</button>',
        '    <button class="gpm-btn" id="gpm-btn-doc" type="button">Export Word</button>',
        '  </div>',
        '</div>',
        '<input id="gpm-search" type="search" placeholder="Search prompts..." aria-label="Search prompts">',
        '<div id="gpm-prompt-list-wrap">',
        '  <div id="gpm-prompt-list" role="list"></div>',
        '</div>',
        '<div id="gpm-counter-bar">',
        '  <span id="gpm-selection-count">Selected: 0</span>',
        '  <span id="gpm-selected-token-count">Selected est. tokens: 0</span>',
        '</div>'
    ].join('');
    document.body.appendChild(panel);

    const refs = {
        refresh: panel.querySelector('#gpm-refresh'),
        toggle: panel.querySelector('#gpm-toggle'),
        count: panel.querySelector('#gpm-count'),
        list: panel.querySelector('#gpm-prompt-list'),
        search: panel.querySelector('#gpm-search'),
        summary: panel.querySelector('#gpm-btn-summary'),
        copy: panel.querySelector('#gpm-btn-copy'),
        pdf: panel.querySelector('#gpm-btn-pdf'),
        doc: panel.querySelector('#gpm-btn-doc')
    };

    // new refs
    const tabAllBtn = panel.querySelector('#gpm-tab-all');
    const tabFavBtn = panel.querySelector('#gpm-tab-fav');
    const selectionCount = panel.querySelector('#gpm-selection-count');
    const selectedTokenCount = panel.querySelector('#gpm-selected-token-count');

    const favorites = new Set();
    let activeTab = 'all';

    document.documentElement.classList.remove('gpm-night');
    document.documentElement.classList.add('gpm-light');

    function downloadFile(filename, content, mime) {
        const blob = new Blob([content], { type: mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    function notify(message) {
        const existing = document.getElementById('gpm-status');
        if (existing) {
            existing.textContent = message;
            return;
        }

        const status = document.createElement('div');
        status.id = 'gpm-status';
        status.textContent = message;
        panel.appendChild(status);

        window.setTimeout(() => {
            if (status.parentNode) {
                status.parentNode.removeChild(status);
            }
        }, 1800);
    }

    function stripYouSaidPrefix(text) {
        return text.replace(/^\s*you said\s*[:\-]?\s*/i, '').trim();
    }

    function normalizeWhitespace(text) {
        return text.replace(/\s+/g, ' ').trim();
    }

    function sanitizeText(text) {
        return normalizeWhitespace(stripYouSaidPrefix(text || ''));
    }

    function makePreview(text, index) {
        const clean = sanitizeText(text);
        const short = clean.length > PREVIEW_LIMIT ? clean.slice(0, PREVIEW_LIMIT).trimEnd() + '...' : clean;
        return '#' + (index + 1) + ': ' + (short || '(empty prompt)');
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getPromptText(node) {
        if (!node) {
            return '';
        }
        return sanitizeText(node.innerText || node.textContent || '');
    }

    function looksLikeUserPrompt(element) {
        if (!element || panel.contains(element)) {
            return false;
        }

        const text = sanitizeText(element.innerText || '');
        if (!text) {
            return false;
        }

        const attrs = [
            (element.getAttribute('data-message-author-role') || '').toLowerCase(),
            (element.getAttribute('data-author') || '').toLowerCase(),
            (element.getAttribute('aria-label') || '').toLowerCase()
        ].join(' ');

        const className = (element.className || '').toString().toLowerCase();
        // match a wider variety of author markers used across AI UIs
        return attrs.includes('user')
            || className.includes('user-query')
            || className.includes('query-text')
            || className.includes('message--user')
            || className.includes('usermessage')
            || className.includes('from-user')
            || className.includes('user')
            || /^you said\b/i.test(text);
    }

    function getUserPromptNodes() {
        const exact = Array.from(document.querySelectorAll('user-query'));
        if (exact.length > 0) {
            return exact.filter((node) => !panel.contains(node) && getPromptText(node));
        }

        const candidates = Array.from(document.querySelectorAll([
            '[data-message-author-role="user"]',
            '[data-author="user"]',
            '.user-query',
            '.query-text',
            '[role="listitem"]',
            'div[data-testid^="message"]',
            '.chat-message',
            '.message',
            '.msg',
            '.c-message',
            '.chat-line',
            '.prose',
            '.whitespace-pre-wrap',
            '.text-base'
        ].join(',')));

        const deduped = [];
        const seen = new Set();

        for (const node of candidates) {
            if (!looksLikeUserPrompt(node)) {
                continue;
            }
            if (seen.has(node)) {
                continue;
            }
            seen.add(node);
            deduped.push(node);
        }

        return deduped;
    }

    function isUserContainer(node) {
        if (!node) {
            return false;
        }

        if (node.matches && node.matches('user-query, [data-message-author-role="user"], [data-author="user"], .user-query')) {
            return true;
        }

        if (node.querySelector && node.querySelector('user-query, [data-message-author-role="user"], [data-author="user"], .user-query')) {
            return true;
        }

        return looksLikeUserPrompt(node);
    }

    function getConversationContainer(promptNode) {
        return promptNode.closest('[role="listitem"], .conversation-turn, .turn-container, .chat-turn, .message, message-content') || promptNode.parentElement;
    }

    function collectResponseNodesFromContainer(container) {
        if (!container) {
            return [];
        }

        const selectors = [
            'model-response',
            '.model-response',
            '.model-response-text',
            '[data-message-author-role="model"]',
            '[data-message-author-role="assistant"]',
            '[data-author="model"]',
            '.message-content',
            '.markdown',
            '.prose'
        ].join(',');

        const matches = [];
        if (container.matches && container.matches(selectors)) {
            matches.push(container);
        }

        if (container.querySelectorAll) {
            const inside = Array.from(container.querySelectorAll(selectors));
            for (const node of inside) {
                if (panel.contains(node)) {
                    continue;
                }
                if (looksLikeUserPrompt(node)) {
                    continue;
                }
                matches.push(node);
            }
        }

        return matches;
    }

    function sanitizeResponseHtml(node) {
        const clone = node.cloneNode(true);
        clone.querySelectorAll('script,style,button,textarea,input,video,canvas,svg,img,.copy-button,.feedback-buttons,[role="button"]').forEach((el) => el.remove());
        return serializePrintNode(clone).trim();
    }

    function serializePrintNode(node) {
        if (!node) {
            return '';
        }

        if (node.nodeType === Node.TEXT_NODE) {
            return escapeHtml(node.textContent || '');
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return '';
        }

        const tag = node.tagName.toLowerCase();
        if (['script', 'style', 'button', 'textarea', 'input', 'video', 'canvas', 'svg', 'img'].includes(tag)) {
            return '';
        }

        if (tag === 'br') {
            return '<br>';
        }

        const children = Array.from(node.childNodes).map((child) => serializePrintNode(child)).join('');

        if (tag === 'pre') {
            return `<pre>${children}</pre>`;
        }

        if (tag === 'code') {
            return `<code>${children}</code>`;
        }

        if (tag === 'strong' || tag === 'b') {
            return `<strong>${children}</strong>`;
        }

        if (tag === 'em' || tag === 'i') {
            return `<em>${children}</em>`;
        }

        if (tag === 'a') {
            const href = node.getAttribute('href') || '';
            return `<a href="${escapeHtml(href)}">${children || escapeHtml(node.textContent || '')}</a>`;
        }

        if (tag === 'ul' || tag === 'ol' || tag === 'li' || tag === 'p' || tag === 'blockquote' || tag === 'hr' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'table' || tag === 'thead' || tag === 'tbody' || tag === 'tr' || tag === 'td' || tag === 'th') {
            return `<${tag}>${children}</${tag}>`;
        }

        return children;
    }

    function htmlToPlainText(html) {
        const d = document.createElement('div');
        d.innerHTML = html || '';
        return d.innerText || '';
    }

    function isAfterNode(baseNode, targetNode) {
        if (!baseNode || !targetNode || baseNode === targetNode) {
            return false;
        }
        return Boolean(baseNode.compareDocumentPosition(targetNode) & Node.DOCUMENT_POSITION_FOLLOWING);
    }

    function isBeforeNode(baseNode, targetNode) {
        if (!baseNode || !targetNode || baseNode === targetNode) {
            return false;
        }
        return Boolean(baseNode.compareDocumentPosition(targetNode) & Node.DOCUMENT_POSITION_PRECEDING);
    }

    function getAssistantResponseNodes() {
        // broaden selectors to support other AI UIs (ChatGPT, Claude, etc.)
        const strongSelector = [
            'model-response',
            '.model-response',
            '.model-response-text',
            '[data-message-author-role="model"]',
            '[data-message-author-role="assistant"]',
            '[data-author="model"]',
            '.response-content',
            '.assistant',
            '.assistant-response',
            '.ai-response',
            '.bot-response',
            '.message--assistant',
            '[data-author="assistant"]'
        ].join(',');

        const broadSelector = ['.message-content', '.markdown', '.prose', '.chat-message', '.message__content', '.content'].join(',');

        function toTopLevel(nodes) {
            const candidateSet = new Set(nodes);
            return nodes.filter((node) => {
                let parent = node.parentElement;
                while (parent) {
                    if (candidateSet.has(parent)) {
                        return false;
                    }
                    parent = parent.parentElement;
                }
                return true;
            });
        }

        function isGoodCandidate(node) {
            if (!node || panel.contains(node)) {
                return false;
            }
            if (looksLikeUserPrompt(node)) {
                return false;
            }
            const text = sanitizeText(node.innerText || node.textContent || '');
            if (text.length < 12) {
                return false;
            }
            const className = (node.className || '').toString().toLowerCase();
            if (className.includes('composer') || className.includes('input') || className.includes('toolbar')) {
                return false;
            }
            return true;
        }

        let rawCandidates = Array.from(document.querySelectorAll(strongSelector)).filter(isGoodCandidate);

        if (rawCandidates.length === 0) {
            rawCandidates = Array.from(document.querySelectorAll(broadSelector)).filter((node) => {
                if (!isGoodCandidate(node)) {
                    return false;
                }
                const text = sanitizeText(node.innerText || node.textContent || '');
                const hasContentTags = Boolean(node.querySelector('p,pre,code,ul,ol,table,blockquote,h1,h2,h3,h4,strong'));
                return hasContentTags || text.length > 80;
            });
        }

        return toTopLevel(rawCandidates);
    }

    function setPanelMinimized(minimized) {
        isMinimized = minimized;
        panel.classList.toggle('gpm-minimized', minimized);
        refs.toggle.textContent = minimized ? '+' : '−';
        refs.toggle.title = minimized ? 'Expand panel' : 'Minimize panel';
        refs.toggle.setAttribute('aria-label', refs.toggle.title);
    }

    function loadSavedPanelPosition() {
        try {
            const raw = localStorage.getItem(POSITION_STORAGE_KEY);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed.left !== 'number' || typeof parsed.top !== 'number') {
                return null;
            }
            return parsed;
        } catch (error) {
            return null;
        }
    }

    function savePanelPosition(left, top) {
        try {
            localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({ left, top }));
        } catch (error) {
            // Ignore storage errors to avoid breaking primary functionality.
        }
    }

    function clampPanelPosition(left, top) {
        const panelWidth = panel.offsetWidth || 340;
        const panelHeight = panel.offsetHeight || 200;
        const maxLeft = Math.max(0, window.innerWidth - panelWidth);
        const maxTop = Math.max(0, window.innerHeight - panelHeight);
        return {
            left: Math.min(Math.max(0, left), maxLeft),
            top: Math.min(Math.max(0, top), maxTop)
        };
    }

    function applyPanelPosition(left, top, persist) {
        const clamped = clampPanelPosition(left, top);
        panel.style.left = clamped.left + 'px';
        panel.style.top = clamped.top + 'px';
        panel.style.right = 'auto';
        if (persist) {
            savePanelPosition(clamped.left, clamped.top);
        }
    }

    function resetPanelPosition() {
        panel.style.left = '';
        panel.style.top = '';
        panel.style.right = '12px';
        panel.style.bottom = 'auto';
        try {
            localStorage.removeItem(POSITION_STORAGE_KEY);
        } catch (error) {
            // Ignore storage errors.
        }
        window.setTimeout(() => {
            const rect = panel.getBoundingClientRect();
            applyPanelPosition(Math.max(12, window.innerWidth - rect.width - 12), 12, true);
        }, 0);
    }

    function startDrag(e) {
        if (typeof e.button === 'number' && e.button !== 0) {
            return;
        }

        const target = e.target;
        if (target.closest && target.closest('#gpm-toggle')) {
            return;
        }

        if (!isMinimized) {
            if (!target.closest('#gpm-header')) {
                return;
            }
        }

        const rect = panel.getBoundingClientRect();
        dragState.active = true;
        dragState.pointerId = e.pointerId;
        dragState.startX = e.clientX;
        dragState.startY = e.clientY;
        dragState.startLeft = rect.left;
        dragState.startTop = rect.top;
        panel.classList.add('gpm-dragging');

        if (panel.setPointerCapture) {
            panel.setPointerCapture(e.pointerId);
        }

        e.preventDefault();
    }

    function moveDrag(e) {
        if (!dragState.active) {
            return;
        }
        if (dragState.pointerId !== null && e.pointerId !== dragState.pointerId) {
            return;
        }

        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        applyPanelPosition(dragState.startLeft + dx, dragState.startTop + dy, false);
    }

    function endDrag(e) {
        if (!dragState.active) {
            return;
        }
        if (dragState.pointerId !== null && e.pointerId !== dragState.pointerId) {
            return;
        }

        dragState.active = false;
        panel.classList.remove('gpm-dragging');

        const rect = panel.getBoundingClientRect();
        applyPanelPosition(rect.left, rect.top, true);

        if (panel.releasePointerCapture && dragState.pointerId !== null) {
            try {
                panel.releasePointerCapture(dragState.pointerId);
            } catch (error) {
                // Ignore if capture is already released.
            }
        }

        dragState.pointerId = null;
    }

    function ensureSelectionStillValid() {
        for (const index of Array.from(selectedIndices)) {
            if (index >= promptNodes.length) {
                selectedIndices.delete(index);
            }
        }
    }

    function updateActiveCardClasses() {
        refs.list.querySelectorAll('.gpm-card').forEach((card) => {
            const idx = Number(card.dataset.index);
            card.classList.toggle('gpm-active', idx === activePromptIndex);
        });
    }

    function createCard(index, text) {
        const card = document.createElement('div');
        card.className = 'gpm-card';
        card.setAttribute('role', 'listitem');
        card.dataset.index = String(index);

        if (selectedIndices.has(index)) {
            card.classList.add('gpm-selected');
        }
        if (index === activePromptIndex) {
            card.classList.add('gpm-active');
        }

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'gpm-checkbox';
        checkbox.checked = selectedIndices.has(index);

        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            if (checkbox.checked) {
                selectedIndices.add(index);
                card.classList.add('gpm-selected');
            } else {
                selectedIndices.delete(index);
                card.classList.remove('gpm-selected');
            }
        });

        const textWrap = document.createElement('div');
        textWrap.className = 'gpm-card-title';
        textWrap.textContent = makePreview(text, index);

        // favorite star
        const favBtn = document.createElement('button');
        favBtn.className = 'gpm-fav-btn';
        favBtn.title = 'Favorite';
        favBtn.innerText = favorites.has(index) ? '★' : '☆';
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (favorites.has(index)) {
                favorites.delete(index);
                favBtn.innerText = '☆';
            } else {
                favorites.add(index);
                favBtn.innerText = '★';
            }
            renderPromptList();
        });

        card.addEventListener('click', () => {
            const target = promptNodes[index];
            if (!target) {
                return;
            }
            activePromptIndex = index;
            updateActiveCardClasses();
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });

        card.appendChild(checkbox);
        card.appendChild(textWrap);
        card.appendChild(favBtn);
        return card;
    }

    function renderPromptList() {
        // preserve scroll position to avoid jumping when list re-renders
        const prevScrollTop = refs.list ? refs.list.scrollTop : 0;
        const prevScrollHeight = refs.list ? refs.list.scrollHeight : 0;
        refs.list.innerHTML = '';
        const searchTerm = refs.search.value.trim().toLowerCase();
        const exportBlocks = buildExportBlocks();

        const filtered = [];
        promptNodes.forEach((node, index) => {
            const text = getPromptText(node);
            if (!text) {
                return;
            }
            if (searchTerm && !text.toLowerCase().includes(searchTerm)) {
                return;
            }
            if (activeTab === 'fav' && !favorites.has(index)) return;
            filtered.push({ index, text });
        });

        if (!filtered.length) {
            const empty = document.createElement('div');
            empty.className = 'gpm-empty';
            empty.textContent = searchTerm ? 'No prompts match your search.' : 'No prompts detected yet.';
            refs.list.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        filtered.forEach((item) => fragment.appendChild(createCard(item.index, item.text)));
        refs.list.appendChild(fragment);

        // restore previous scroll position where possible (clamped)
        try {
            const maxScroll = Math.max(0, refs.list.scrollHeight - refs.list.clientHeight);
            refs.list.scrollTop = Math.min(prevScrollTop, maxScroll);
        } catch (e) {
            // ignore if restoring scroll fails
        }

        const selectedPromptIndices = getSelectedPromptIndices();
        selectionCount.textContent = 'Selected: ' + selectedPromptIndices.length;

        let selectedTokens = 0;
        for (const index of selectedPromptIndices) {
            selectedTokens += estimatePromptTokens(index, exportBlocks);
        }

        selectedTokenCount.textContent = 'Selected est. tokens: ' + selectedTokens;
    }

    function refreshPrompts() {
        promptNodes = getUserPromptNodes();
        ensureSelectionStillValid();
        refs.count.textContent = promptNodes.length + ' prompts';
        renderPromptList();
    }

    function scheduleRefresh() {
        if (refreshTimer) {
            window.clearTimeout(refreshTimer);
        }

        refreshTimer = window.setTimeout(() => {
            refreshPrompts();
        }, DEBOUNCE_MS);
    }

    function updateActivePromptFromViewport() {
        if (!promptNodes.length) {
            activePromptIndex = -1;
            updateActiveCardClasses();
            return;
        }

        const viewportCenter = window.innerHeight / 2;
        let bestIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (let i = 0; i < promptNodes.length; i += 1) {
            const rect = promptNodes[i].getBoundingClientRect();
            const center = rect.top + rect.height / 2;
            const distance = Math.abs(center - viewportCenter);

            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = i;
            }
        }

        if (bestIndex !== activePromptIndex) {
            activePromptIndex = bestIndex;
            updateActiveCardClasses();
        }
    }

    function requestActivePromptCheck() {
        if (scrollTicking) {
            return;
        }

        scrollTicking = true;
        window.requestAnimationFrame(() => {
            updateActivePromptFromViewport();
            scrollTicking = false;
        });
    }

    function getSelectedPromptIndices() {
        return Array.from(selectedIndices)
            .sort((a, b) => a - b)
            .filter((index) => index >= 0 && index < promptNodes.length);
    }

    function collectSelectedPromptTexts() {
        return getSelectedPromptIndices().map((index) => getPromptText(promptNodes[index])).filter(Boolean);
    }

    function estimateTokensFromText(text) {
        const normalized = normalizeWhitespace(text || '');
        if (!normalized) {
            return 0;
        }

        // hybrid heuristic: combine word-based and char-based estimates
        const words = normalized.split(/\s+/).filter(Boolean).length;
        const chars = normalized.length;

        // tokens approximations
        const tokensFromWords = Math.round(words / 0.75); // ~1.33 tokens per word
        const tokensFromChars = Math.round(chars / 4); // ~4 chars per token

        // average the two estimates, but ensure at least 1
        const estimate = Math.max(1, Math.round((tokensFromWords + tokensFromChars) / 2));
        return estimate;
    }

    function getAssistantTextForPrompt(index, blocks) {
        const block = blocks.find((item) => item.index === index);
        if (!block || !block.responses.length) {
            return '';
        }

        return block.responses.map((html) => htmlToPlainText(html)).join(' ');
    }

    function estimatePromptTokens(index, blocks) {
        const promptNode = promptNodes[index];
        if (!promptNode) {
            return 0;
        }

        return estimateTokensFromText(getPromptText(promptNode) + ' ' + getAssistantTextForPrompt(index, blocks));
    }

    function findComposerInput() {
        const selectors = [
            'div[contenteditable="true"][role="textbox"]',
            'div[contenteditable="true"][aria-label*="Message"]',
            'div[contenteditable="true"][aria-label*="Gemini"]',
            'rich-textarea div[contenteditable="true"]',
            'div[contenteditable="true"]'
        ];

        for (const selector of selectors) {
            const candidates = Array.from(document.querySelectorAll(selector));
            const node = candidates.find((candidate) => !panel.contains(candidate) && candidate.offsetParent !== null);
            if (node) {
                return node;
            }
        }

        return null;
    }

    function insertTextIntoContentEditable(element, text) {
        element.focus();

        const selection = window.getSelection();
        if (selection) {
            const range = document.createRange();
            range.selectNodeContents(element);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        }

        const inserted = document.execCommand('insertText', false, text);
        if (!inserted) {
            element.textContent = text;
        }

        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const temp = document.createElement('textarea');
        temp.value = text;
        document.body.appendChild(temp);
        temp.focus();
        temp.select();
        document.execCommand('copy');
        temp.remove();
    }

    function buildExportBlocks() {
        const selected = getSelectedPromptIndices();
        if (!selected.length) {
            return [];
        }

        const assistantNodes = getAssistantResponseNodes();

        const blocks = [];
        for (const index of selected) {
            const promptNode = promptNodes[index];
            if (!promptNode) {
                continue;
            }

            const nextPromptNode = promptNodes[index + 1] || null;

            const userQuestion = getPromptText(promptNode);
            const responses = [];
            const responseFingerprints = new Set();

            for (const assistantNode of assistantNodes) {
                if (promptNode.contains(assistantNode)) {
                    continue;
                }
                if (!isAfterNode(promptNode, assistantNode)) {
                    continue;
                }
                if (nextPromptNode && !isBeforeNode(nextPromptNode, assistantNode)) {
                    continue;
                }

                const html = sanitizeResponseHtml(assistantNode);
                if (html) {
                    const textFingerprint = sanitizeText(assistantNode.innerText || assistantNode.textContent || '').slice(0, 500);
                    const htmlFingerprint = html.slice(0, 700);
                    const fingerprint = textFingerprint + '|' + htmlFingerprint;
                    if (!responseFingerprints.has(fingerprint)) {
                        responseFingerprints.add(fingerprint);
                        responses.push(html);
                    }
                }
            }

            blocks.push({ index, question: userQuestion, responses });
        }

        return blocks;
    }

    function createPrintDocument(blocks) {
        const rendered = blocks.map((block) => {
            const responseHtml = block.responses.length
                ? block.responses.map((html) => '<div class="response-box">' + html + '</div>').join('')
                : '<div class="response-box"><em>No response was found for this prompt.</em></div>';

            return [
                '<section class="entry">',
                '  <h2>Prompt #' + (block.index + 1) + '</h2>',
                '  <div class="question-box">' + escapeHtml(block.question || '(empty prompt)') + '</div>',
                '  <div class="response-wrap">' + responseHtml + '</div>',
                '</section>'
            ].join('');
        }).join('');

        return [
            '<!doctype html>',
            '<html>',
            '<head>',
            '  <meta charset="utf-8">',
            '  <title>Gemini Export</title>',
            '  <style>',
            '    * { box-sizing: border-box; }',
            '    @page { size: A4; margin: 12mm; }',
            '    html, body { margin: 0; padding: 0; }',
            '    body { font-family: "Inter", "Segoe UI", Arial, sans-serif; line-height: 1.65; color: #1d1f27; background: #ffffff; }',
            '    .doc-header { margin-bottom: 16px; padding: 14px 16px; border-radius: 12px; background: linear-gradient(135deg, #1f1730, #403067); color: #f3edff; }',
            '    h1 { font-size: 24px; line-height: 1.2; margin: 0 0 4px; }',
            '    .sub { font-size: 12px; opacity: 0.85; }',
            '    h2 { font-size: 17px; margin: 0 0 10px; color: #2a2c33; }',
            '    .entry { margin: 0 0 18px; padding: 12px 12px 6px; border: 1px solid #ece8f5; border-radius: 12px; background: #ffffff; break-inside: avoid-page; page-break-inside: avoid; }',
            '    .question-box { background: #eef1f5; border: 1px solid #d8dce4; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; white-space: pre-wrap; font-size: 14px; overflow-wrap: anywhere; }',
            '    .response-wrap { margin-bottom: 6px; }',
            '    .response-box { border-left: 4px solid #bd93f9; background: #faf7ff; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; overflow-wrap: anywhere; }',
            '    .response-box, .response-box * { box-sizing: border-box; }',
            '    .response-box p { margin: 0 0 10px; }',
            '    .response-box h1, .response-box h2, .response-box h3, .response-box h4 { margin: 12px 0 8px; line-height: 1.25; }',
            '    .response-box p:last-child, .response-box ul:last-child, .response-box ol:last-child, .response-box blockquote:last-child, .response-box pre:last-child, .response-box table:last-child { margin-bottom: 0; }',
            '    ul, ol { margin: 0 0 10px 18px; }',
            '    blockquote { margin: 0 0 10px; padding: 8px 12px; border-left: 3px solid #c5b3eb; background: #f7f3ff; border-radius: 8px; }',
            '    pre { background: #1f2230; color: #eef0ff; border: 1px solid #272b3d; border-radius: 8px; overflow-x: auto; padding: 11px; white-space: pre-wrap; page-break-inside: avoid; margin: 0 0 10px; }',
            '    code { font-family: "SFMono-Regular", "Consolas", "Menlo", monospace; font-size: 12px; }',
            '    :not(pre) > code { background: #f2ebff; color: #5d3791; padding: 1px 5px; border-radius: 6px; }',
            '    strong { font-weight: 700; }',
            '    a { color: #6b47a5; text-decoration: underline; }',
            '    table { width: 100%; border-collapse: collapse; margin: 0 0 10px; }',
            '    th, td { border: 1px solid #d8dce4; padding: 8px 10px; vertical-align: top; }',
            '    th { background: #f1ecff; }',
            '    hr { border: 0; border-top: 1px solid #ece8f5; margin: 14px 0 12px; }',
            '  </style>',
            '</head>',
            '<body>',
            '  <header class="doc-header">',
            '    <h1>Gemini Conversation Export</h1>',
            '    <div class="sub">Generated by Gemini Pro Manager</div>',
            '  </header>',
            rendered,
            '</body>',
            '</html>'
        ].join('');
    }

    function openPrintFrame(html) {
        const iframe = document.createElement('iframe');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.position = 'fixed';
        iframe.style.width = '1px';
        iframe.style.height = '1px';
        iframe.style.right = '-9999px';
        iframe.style.bottom = '0';
        iframe.style.border = '0';
        iframe.style.opacity = '0';
        document.body.appendChild(iframe);

        const frameDoc = iframe.contentWindow.document;
        frameDoc.open();
        frameDoc.write(html);
        frameDoc.close();

        window.setTimeout(() => {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            window.setTimeout(() => {
                iframe.remove();
            }, 1500);
        }, 350);
    }

    refs.toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setPanelMinimized(!isMinimized);
    });

    // reset button removed — resetting handled via context menu or manual reposition

    panel.addEventListener('pointerdown', startDrag);
    panel.addEventListener('pointermove', moveDrag);
    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);

    refs.search.addEventListener('input', () => {
        renderPromptList();
    });

    tabAllBtn.addEventListener('click', () => {
        activeTab = 'all';
        tabAllBtn.classList.add('gpm-tab--active');
        tabFavBtn.classList.remove('gpm-tab--active');
        renderPromptList();
    });

    tabFavBtn.addEventListener('click', () => {
        activeTab = 'fav';
        tabFavBtn.classList.add('gpm-tab--active');
        tabAllBtn.classList.remove('gpm-tab--active');
        renderPromptList();
    });

    // Jump controls removed — no-op

    refs.summary.addEventListener('click', () => {
        const selectedPrompts = collectSelectedPromptTexts();
        if (!selectedPrompts.length) {
            notify('Select prompts first.');
            return;
        }

        const input = findComposerInput();
        if (!input) {
            notify('Composer input not found.');
            return;
        }

        const command = [
            'Summarize these points:',
            '',
            selectedPrompts.map((text, i) => (i + 1) + '. ' + text).join('\n')
        ].join('\n');

        insertTextIntoContentEditable(input, command);
        notify('Summary prompt injected.');
    });

    refs.copy.addEventListener('click', async () => {
        // Build export blocks (prompt + collected assistant responses)
        const blocks = buildExportBlocks();
        if (!blocks || !blocks.length) {
            notify('Select prompts first.');
            return;
        }

        // Assemble plain-text export: include prompt and response texts
        const parts = [];
        for (const block of blocks) {
            parts.push('Prompt #' + (block.index + 1) + ':');
            parts.push(block.question || '(empty prompt)');

            if (block.responses && block.responses.length) {
                for (let i = 0; i < block.responses.length; i++) {
                    const html = block.responses[i] || '';
                    const text = htmlToPlainText(html).trim();
                    parts.push('Response ' + (i + 1) + ':');
                    parts.push(text || '(no textual response)');
                }
            } else {
                parts.push('Response: (no response found)');
            }

            parts.push('\n---\n');
        }

        const finalText = parts.join('\n');
        try {
            await copyToClipboard(finalText);
            notify('Copied prompts + responses.');
        } catch (error) {
            notify('Clipboard copy failed.');
        }
    });

    refs.pdf.addEventListener('click', () => {
        const blocks = buildExportBlocks();
        if (!blocks.length) {
            notify('Select prompts first.');
            return;
        }

        const html = createPrintDocument(blocks);
        openPrintFrame(html);
        notify('Preparing print dialog...');
    });

    // Export as Word (.doc) by creating an HTML document and downloading with MS Word mime.
    refs.doc.addEventListener('click', () => {
        const blocks = buildExportBlocks();
        if (!blocks.length) {
            notify('Select prompts first.');
            return;
        }

        const html = createPrintDocument(blocks);
        const now = new Date();
        const stamp = now.toISOString().replace(/[:.]/g, '-');
        const filename = `gemini-export-${stamp}.doc`;

        try {
            downloadFile(filename, html, 'application/msword');
            notify('Preparing Word download...');
        } catch (err) {
            notify('Word export failed.');
        }
    });

    // refresh button: re-scan prompts and show most-recent-first
    if (refs.refresh) {
        refs.refresh.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                // keep the original ordering as discovered on the page
                promptNodes = getUserPromptNodes();
                ensureSelectionStillValid();
                refs.count.textContent = promptNodes.length + ' prompts';
                renderPromptList();
                notify('Prompts refreshed');
            } catch (err) {
                notify('Refresh failed');
            }
        });
    }

    const observer = new MutationObserver((mutations) => {
        let shouldRefresh = false;
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && (mutation.addedNodes.length || mutation.removedNodes.length)) {
                shouldRefresh = true;
                break;
            }
            if (mutation.type === 'characterData') {
                shouldRefresh = true;
                break;
            }
        }

        if (shouldRefresh) {
            scheduleRefresh();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    window.addEventListener('scroll', requestActivePromptCheck, { passive: true });
    window.addEventListener('hashchange', scheduleRefresh);
    window.addEventListener('popstate', scheduleRefresh);
    window.addEventListener('resize', () => {
        scheduleRefresh();
        const rect = panel.getBoundingClientRect();
        applyPanelPosition(rect.left, rect.top, true);
    });

    const savedPos = loadSavedPanelPosition();
    if (savedPos) {
        applyPanelPosition(savedPos.left, savedPos.top, false);
    }

    refreshPrompts();
    window.setTimeout(refreshPrompts, 1100);
})();
