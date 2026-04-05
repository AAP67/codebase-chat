import React, { useState, useEffect, useRef } from "react";
import "./App.css";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

function App() {
  const [token, setToken] = useState(localStorage.getItem("gh_token") || "");
  const [repos, setRepos] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [fileTree, setFileTree] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code && !token) {
      fetch(`${API_URL}/auth/callback?code=${code}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.access_token) {
            setToken(data.access_token);
            localStorage.setItem("gh_token", data.access_token);
            window.history.replaceState({}, "", "/");
          }
        })
        .catch((err) => console.error("OAuth error:", err));
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      setLoadingRepos(true);
      fetch(`${API_URL}/repos?token=${token}`)
        .then((r) => r.json())
        .then((data) => {
          setRepos(data);
          setLoadingRepos(false);
        })
        .catch(() => setLoadingRepos(false));
    }
  }, [token]);

  useEffect(() => {
    if (selectedRepo && token) {
      fetch(`${API_URL}/repo/tree?token=${token}&repo=${selectedRepo}`)
        .then((r) => r.json())
        .then((data) => setFileTree(data.files || []))
        .catch(() => setFileTree([]));
    }
  }, [selectedRepo, token]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleLogin = () => {
    window.location.href = `${API_URL}/auth/login`;
  };

  const handleLogout = () => {
    setToken("");
    setRepos([]);
    setSelectedRepo("");
    setMessages([]);
    localStorage.removeItem("gh_token");
  };

  const handleSend = async () => {
    if (!input.trim() || !selectedRepo || loading) return;
    const userMsg = { role: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const resp = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, repo: selectedRepo, question: input }),
      });
      const data = await resp.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.answer, filesLoaded: data.files_loaded },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Error: Could not get a response." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!token) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="logo">&#x2318;</div>
          <h1>Codebase Chat</h1>
          <p>Chat with any GitHub repo using AI</p>
          <button className="login-btn" onClick={handleLogin}>
            <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Sign in with GitHub
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="logo-sm">&#x2318;</span>
          <h2>Codebase Chat</h2>
        </div>
        <div className="header-right">
          <select
            className="repo-select"
            value={selectedRepo}
            onChange={(e) => {
              setSelectedRepo(e.target.value);
              setMessages([]);
              setShowFiles(false);
            }}
          >
            <option value="">Select a repo...</option>
            {repos.map((r) => (
              <option key={r.full_name} value={r.full_name}>
                {r.private ? "~ " : ""}{r.full_name}
                {r.language ? ` [${r.language}]` : ""}
              </option>
            ))}
          </select>
          {loadingRepos && <span className="loading-dot">Loading...</span>}
          <button className="logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <div className="main">
        {selectedRepo && showFiles && (
          <aside className="sidebar">
            <div className="sidebar-header">
              <h3>Files</h3>
              <span className="file-count">{fileTree.length}</span>
            </div>
            <div className="file-list">
              {fileTree.map((f) => (
                <div key={f} className="file-item" title={f}>{f}</div>
              ))}
            </div>
          </aside>
        )}

        <div className="chat-area">
          {!selectedRepo ? (
            <div className="empty-state">
              <div className="empty-icon">&#128194;</div>
              <h3>Select a repository</h3>
              <p>Pick a repo from the dropdown to start chatting</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">&#128172;</div>
              <h3>{selectedRepo}</h3>
              <p>Ask anything about this codebase</p>
              <div className="suggestions">
                {[
                  "What does this project do?",
                  "Explain the architecture",
                  "What are the main dependencies?",
                  "Find potential bugs",
                ].map((s) => (
                  <button key={s} className="suggestion-btn" onClick={() => setInput(s)}>{s}</button>
                ))}
              </div>
              <button className="toggle-files" onClick={() => setShowFiles(!showFiles)}>
                {showFiles ? "Hide" : "Show"} file tree ({fileTree.length} files)
              </button>
            </div>
          ) : (
            <div className="messages">
              {messages.map((msg, i) => (
                <div key={i} className={`message ${msg.role}`}>
                  <div className="message-header">{msg.role === "user" ? "You" : "AI"}</div>
                  <div className="message-body">
                    {msg.text}
                    {msg.filesLoaded > 0 && (
                      <div className="files-badge">Analyzed {msg.filesLoaded} files</div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="message assistant">
                  <div className="message-header">AI</div>
                  <div className="message-body loading-msg">Reading codebase...</div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          {selectedRepo && (
            <div className="input-area">
              <div className="input-row">
                <button className="files-toggle-btn" onClick={() => setShowFiles(!showFiles)} title="Toggle files">&#128193;</button>
                <textarea
                  className="chat-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about the codebase..."
                  rows={1}
                  disabled={loading}
                />
                <button className="send-btn" onClick={handleSend} disabled={loading || !input.trim()}>
                  {loading ? "..." : ">"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
