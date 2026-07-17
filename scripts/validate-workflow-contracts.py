#!/usr/bin/env python3
"""Validate model portability and the workbench's Agent/MCP workflow contracts."""
from __future__ import annotations

import re
import sys
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_AGENTS = {
    "creative-producer", "screenwriter", "director-reviewer", "audience-reviewer",
    "cinematographer", "asset-designer", "asset-continuity-reviewer", "storyboard-artist",
    "image-prompt-designer", "video-prompt-designer", "audio-supervisor", "editor-reviewer",
    "brand-reviewer", "generation-supervisor",
}
EXPECTED_SKILLS = {
    "creative-production-orchestration", "gpt-image-2-storyboard",
    "doubao-audio-generation", "seedance-20",
}
EXPECTED_MCP_TOOLS = {
    "list_projects", "create_project", "set_creative_profile", "get_project_context",
    "save_artifact_version", "submit_internal_review", "upsert_asset", "upsert_shot",
    "list_open_revisions", "list_pending_codex_image_requests", "claim_codex_image_request",
    "complete_codex_image_request", "fail_codex_image_request", "resolve_revision",
    "get_skill_status", "prepare_edit_manifest",
    "configure_jianying", "check_jianying_cli", "run_jianying_edit", "get_jianying_edit_status",
    "inspect_edit_output", "approve_final_edit", "reject_final_edit", "cancel_jianying_edit",
}


def main() -> int:
    errors: list[str] = []
    agent_dir = ROOT / ".codex" / "agents"
    files = sorted(agent_dir.glob("*.toml"))
    found_agents = {file.stem for file in files}
    if found_agents != EXPECTED_AGENTS:
        errors.append(f"Agent 集合不一致：缺少 {sorted(EXPECTED_AGENTS - found_agents)}；多出 {sorted(found_agents - EXPECTED_AGENTS)}")

    for file in files:
        try:
            data = tomllib.loads(file.read_text(encoding="utf-8"))
        except Exception as exc:  # pragma: no cover - diagnostic path
            errors.append(f"{file.name} 不是有效 TOML：{exc}")
            continue
        if data.get("name") != file.stem:
            errors.append(f"{file.name} 的 name 必须等于文件名")
        if "model" in data:
            errors.append(f"{file.name} 锁死了模型 {data['model']!r}，不具备跨模型可移植性")
        if not str(data.get("developer_instructions", "")).strip():
            errors.append(f"{file.name} 缺少 developer_instructions")
        if not str(data.get("description", "")).strip():
            errors.append(f"{file.name} 缺少 description")

    role_contracts = (ROOT / ".agents" / "skills" / "creative-production-orchestration" / "references" / "agent-role-contracts.md").read_text(encoding="utf-8")
    for name in EXPECTED_AGENTS:
        if name not in role_contracts:
            errors.append(f"Agent 责任契约未登记：{name}")

    for name in EXPECTED_SKILLS:
        if not (ROOT / ".agents" / "skills" / name / "SKILL.md").is_file():
            errors.append(f"缺少项目级 Skill：{name}")

    mcp_source = (ROOT / "server" / "mcp.ts").read_text(encoding="utf-8")
    found_tools = set(re.findall(r'registerTool\("([^"]+)"', mcp_source))
    if found_tools != EXPECTED_MCP_TOOLS:
        errors.append(f"MCP 工具集合不一致：缺少 {sorted(EXPECTED_MCP_TOOLS - found_tools)}；多出 {sorted(found_tools - EXPECTED_MCP_TOOLS)}")

    workflow = (ROOT / "WORKFLOW.md").read_text(encoding="utf-8")
    for name in EXPECTED_MCP_TOOLS:
        if f"`{name}`" not in workflow:
            errors.append(f"WORKFLOW 未登记 MCP 工具：{name}")
    for stale in ("`submit_review`", "`list_assets`", "`update_asset`", "`create_shot`", "`update_shot`", "`submit_job`", "`poll_job`", "`list_codex_image_requests`"):
        if stale in workflow:
            errors.append(f"WORKFLOW 仍包含失效工具名：{stale}")

    for phrase in ("`voiceBindings`", "`asset://`", "--kind voice-anchor", "镜头首帧退回", "不提供后期配音兜底"):
        if phrase not in workflow:
            errors.append(f"WORKFLOW 缺少音色锚点/首帧返工契约：{phrase}")

    route_source = (ROOT / "server" / "routes.ts").read_text(encoding="utf-8")
    for endpoint in (
        "/api/audio-assets/:audioId/lock-impact",
        "/api/audio-assets/:audioId/lock-voice",
        "/api/audio-assets/:audioId/register-seedance",
        "/api/shots/:shotId/image-revision",
    ):
        if endpoint not in route_source:
            errors.append(f"服务端缺少已登记接口：{endpoint}")

    shared_types = (ROOT / "shared" / "types.ts").read_text(encoding="utf-8")
    for symbol in ("AudioAssetStatus", "ShotVoiceBinding", "voiceBindings", '"audio_registration"'):
        if symbol not in shared_types:
            errors.append(f"共享类型缺少音色锚点契约：{symbol}")

    audio_lint = (ROOT / ".agents" / "skills" / "doubao-audio-generation" / "scripts" / "prompt_lint.py").read_text(encoding="utf-8")
    for phrase in ("voice-anchor", "无音乐", "无环境声", "无音效", "无混响"):
        if phrase not in audio_lint:
            errors.append(f"豆包音频lint缺少音色锚点规则：{phrase}")

    searchable_roots = [ROOT / "server", ROOT / "shared", ROOT / "src", ROOT / "scripts", ROOT / "docs", ROOT / ".codex", ROOT / ".agents"]
    searchable_files = [ROOT / "WORKFLOW.md", ROOT / "AGENTS.md"]
    for directory in searchable_roots:
        searchable_files.extend(path for path in directory.rglob("*") if path.is_file() and path.suffix.lower() in {".ts", ".tsx", ".md", ".toml", ".py", ".ps1", ".json"})
    for path in searchable_files:
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if re.search(r"lib[ -]?tv", content, re.IGNORECASE):
            errors.append(f"发现误留的旧系统引用：{path.relative_to(ROOT)}")

    if errors:
        print("workflow contract validation: FAIL")
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print(f"workflow contract validation: PASS ({len(found_agents)} agents, {len(EXPECTED_SKILLS)} skills, {len(found_tools)} MCP tools)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
