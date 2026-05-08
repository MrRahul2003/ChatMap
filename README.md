# ChatMap: Intelligent Gemini Conversation Navigator 🚀

**ChatMap** is a high-performance Chrome Extension (Manifest V3) designed to bridge the gap between volatile AI chat sessions and structured knowledge management. It provides a sleek, bento-style interface to map, search, and export deep conversations on the Gemini platform.

---

## ✨ Features

- **Semantic Navigation**: Real-time indexing of user prompts using a throttled `MutationObserver` for zero performance lag.
- **Context-Aware PDF Export**: Advanced DOM traversal engine that captures full dialogue blocks—including both your questions and Gemini's full responses.
- **Persistent Selection**: State-management system using JavaScript Sets to ensure selections stay active across dynamic page updates.
- **AI-Powered Summarization**: One-click bundling of selected prompts to trigger recursive AI summaries directly in the chat input.
- **Bento-Style UI**: Modern glassmorphism side panel with a minimize/toggle feature to keep your workspace unobtrusive.

---

## 🏗️ Technical Architecture

- **Manifest V3**: Built with the latest Chrome extension standards for maximum security and efficiency.
- **DOM Traversal Engine**: Specialized logic that identifies `user-query` elements and maps them to their corresponding `model-response` siblings for complete data extraction.
- **Search Logic**: Implements a real-time regex-based filtering engine to reduce prompt retrieval time in long-form threads.

---

## 🛠️ Installation & Setup Guide

Follow these precise steps to get **ChatMap** running in your browser:

### 1. Download the Source
You can either clone the repository or download it as a static folder:
*   **Option A (Clone):** Open your terminal and run:
    ```bash
    git clone https://github.com/MrRahul2003/ChatMap.git
    ```
    
*   **Option B (Download):** Click the green Code button at the top of this page, select Download ZIP, and extract the contents to a folder on your computer.

### 2. Open Chrome Extensions
1. Launch Google Chrome.
2. In the address bar, type `chrome://extensions/` and press Enter.
3. Alternatively, click the three dots (top right) > Extensions > Manage Extensions.

### 3. Enable Developer Mode
1. Locate the Developer mode toggle switch in the top right corner.
2. Ensure it is turned ON.

### 4. Load the Extension
There are two ways to do this:

**Method A (Drag & Drop):** Find your extracted ChatMap folder and drag and drop it anywhere onto the `chrome://extensions/` page.

**Method B (Manual Load):** Click the Load unpacked button in the top left. Navigate to your ChatMap folder, select it, and click Select Folder.

> **Note:** Ensure the folder you select contains the `manifest.json` file.

### 5. Pin and Activate
1. Click the Puzzle Piece icon 🧩 in your Chrome toolbar.
2. Find ChatMap and click the Pin icon.
3. Navigate to gemini.google.com to start mapping your chat.
