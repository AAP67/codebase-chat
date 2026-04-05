import os
import httpx
import anthropic
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import base64

load_dotenv()

app = FastAPI()

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

GITHUB_API = "https://api.github.com"

SKIP_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2",
    ".ttf", ".eot", ".mp4", ".mp3", ".zip", ".tar", ".gz", ".lock",
    ".min.js", ".min.css", ".map",
}

SKIP_PATHS = {
    "node_modules", ".git", "dist", "build", "__pycache__", ".next",
    "venv", ".venv", "env", ".env", "coverage", ".cache",
}

MAX_FILE_SIZE = 50_000
MAX_TOTAL_CHARS = 200_000


def should_skip(path: str) -> bool:
    parts = path.split("/")
    if any(p in SKIP_PATHS for p in parts):
        return True
    if any(path.endswith(ext) for ext in SKIP_EXTENSIONS):
        return True
    return False


@app.get("/")
def root():
    return {"status": "ok", "message": "Codebase Chat API is running"}


@app.get("/auth/login")
def github_login():
    return RedirectResponse(
        f"https://github.com/login/oauth/authorize"
        f"?client_id={GITHUB_CLIENT_ID}"
        f"&scope=repo"
        f"&redirect_uri={FRONTEND_URL}/callback"
    )


@app.get("/auth/callback")
def github_callback(code: str = Query(...)):
    resp = httpx.post(
        "https://github.com/login/oauth/access_token",
        json={
            "client_id": GITHUB_CLIENT_ID,
            "client_secret": GITHUB_CLIENT_SECRET,
            "code": code,
        },
        headers={"Accept": "application/json"},
    )
    data = resp.json()
    if "access_token" not in data:
        raise HTTPException(status_code=400, detail="OAuth failed")
    return {"access_token": data["access_token"]}


async def get_repo_tree(token: str, owner: str, repo: str):
    async with httpx.AsyncClient() as client:
        for branch in ["main", "master"]:
            resp = await client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}/git/trees/{branch}",
                params={"recursive": "1"},
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 200:
                return resp.json().get("tree", [])
        raise HTTPException(status_code=404, detail="Could not fetch repo tree")


async def get_file_content(token: str, owner: str, repo: str, path: str):
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("encoding") == "base64" and data.get("content"):
            content = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
            return content[:MAX_FILE_SIZE]
        return None


async def fetch_codebase(token: str, owner: str, repo: str):
    tree = await get_repo_tree(token, owner, repo)
    files = [f for f in tree if f["type"] == "blob" and not should_skip(f["path"])]

    codebase = {}
    total_chars = 0
    for f in files:
        if total_chars >= MAX_TOTAL_CHARS:
            break
        content = await get_file_content(token, owner, repo, f["path"])
        if content:
            codebase[f["path"]] = content
            total_chars += len(content)
    return codebase


@app.get("/repos")
async def list_repos(token: str = Query(...)):
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{GITHUB_API}/user/repos",
            params={"sort": "updated", "per_page": 30, "type": "owner"},
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="Failed to list repos")
        repos = resp.json()
        return [
            {
                "full_name": r["full_name"],
                "name": r["name"],
                "description": r.get("description", ""),
                "language": r.get("language", ""),
                "updated_at": r["updated_at"],
                "private": r["private"],
            }
            for r in repos
        ]


class ChatRequest(BaseModel):
    token: str
    repo: str
    question: str


@app.post("/chat")
async def chat_with_codebase(req: ChatRequest):
    owner, repo = req.repo.split("/")
    codebase = await fetch_codebase(req.token, owner, repo)

    context_parts = []
    for path, content in codebase.items():
        context_parts.append(f"--- {path} ---\n{content}\n")
    context = "\n".join(context_parts)

    message = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=(
            "You are a senior software engineer analyzing a codebase. "
            "Answer the user's question based on the code provided. "
            "Be specific — reference file names, functions, and logic. "
            "If unsure, say so."
        ),
        messages=[
            {
                "role": "user",
                "content": f"Codebase for {req.repo}:\n\n{context}\n\n---\n\nQuestion: {req.question}",
            }
        ],
    )

    return {
        "answer": message.content[0].text,
        "files_loaded": len(codebase),
        "repo": req.repo,
    }


@app.get("/repo/tree")
async def repo_tree(token: str = Query(...), repo: str = Query(...)):
    owner, repo_name = repo.split("/")
    tree = await get_repo_tree(token, owner, repo_name)
    files = [f["path"] for f in tree if f["type"] == "blob" and not should_skip(f["path"])]
    return {"files": files}
