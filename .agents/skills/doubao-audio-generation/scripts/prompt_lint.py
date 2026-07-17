#!/usr/bin/env python3
"""Lint Doubao voice-anchor and historical scene-master prompts."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


GENERIC_ONLY = ("用稳定、清晰、自然的普通话说", "用稳定、清晰、自然的声音说", "自然地说")
ROLE_RE = re.compile(r"^.{1,180}(?:是|为).{2,}(?:男|女|声线|音色|口音|普通话|方言|拟人).*$")
SPEECH_RE = re.compile(r"^.{1,240}(?:说道|说：|说话|回应|解释|喊道|问道|低声|大声|怒吼|回击|轻声).*[“\"].+[”\"]")
QUOTE_RE = re.compile(r"[“\"].+?[”\"]")
SOUND_RE = re.compile(r"音乐|环境|音效|声音|脚步|电话|震动|呼吸|碰撞|雨声|风声|鼓点|贝斯|合成器|钢琴|铜管|静音")
PERFORMANCE_RE = re.compile(r"停顿|语速|音量|声线|音高|音色|尾音|情绪|咬字|低声|轻声|高声|加快|放慢")
IMITATION_RE = re.compile(r"模仿.*(?:周星驰|刘德华|梁朝伟|具体演员|真实人物)|像.*(?:周星驰|刘德华|梁朝伟)|复制.*(?:演员|声音)|电影原声")


def common_checks(text: str, require_hk: bool, errors: list[str], warnings: list[str]) -> None:
    if require_hk and not re.search(r"港式普通话|香港普通话", text):
        errors.append("90年代港片项目必须明确写出港式普通话。")
    if not PERFORMANCE_RE.search(text):
        errors.append("没有检测到具体表演方向，不能只写抽象的‘自然’。")
    for phrase in GENERIC_ONLY:
        if phrase in text:
            warnings.append(f"发现泛化句式“{phrase}”，请改成角色、速度、音量、停顿和情绪变化。")
    unsafe_imitation_text = re.sub(r"(?:不|不要|不得)模仿[^，。；\n]*", "", text)
    if IMITATION_RE.search(unsafe_imitation_text):
        errors.append("不能要求复制具体演员、真实人物或电影原声；请改写为年龄、口音、音色和表演方式。")


def lint_voice_anchor(text: str, require_hk: bool) -> dict[str, object]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    errors: list[str] = []
    warnings: list[str] = []
    quotes = QUOTE_RE.findall(text)
    role_lines = [line for line in lines if ROLE_RE.search(line)]

    if len(text) < 90:
        errors.append("音色锚点提示词过短，必须写清角色身份、语言口音、声线和表演方式。")
    if not role_lines:
        errors.append("没有检测到角色年龄/性别、语言/口音、声线或音色依据。")
    if not re.search(r"4(?:到|～|-|—)5秒", text):
        errors.append("音色锚点必须明确为4到5秒。")
    if not re.search(r"单角色|单人", text):
        errors.append("音色锚点必须明确只有一个角色。")
    required_dry_rules = {
        "无音乐": r"无音乐|不要音乐",
        "无环境声": r"无环境声|不要环境声",
        "无音效": r"无音效|不要音效",
        "无混响": r"无混响|不要混响",
    }
    missing = [name for name, pattern in required_dry_rules.items() if not re.search(pattern, text)]
    if missing:
        errors.append(f"音色锚点必须是干声，缺少：{'、'.join(missing)}。")
    if len(quotes) != 1:
        errors.append("音色锚点只能包含一句短样本文本。")
    elif len(quotes[0]) > 44:
        errors.append("音色锚点样本文本过长，无法稳定控制在4到5秒。")
    if re.search(r"多人|轮流说|同时说|一起说|合唱", text):
        errors.append("音色锚点不能包含多人、轮流说话或同时说话。")
    common_checks(text, require_hk, errors, warnings)
    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "stats": {"kind": "voice-anchor", "characters": len(text), "role_lines": len(role_lines), "quoted_lines": len(quotes)},
    }


def lint_scene_master(text: str, require_hk: bool) -> dict[str, object]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    errors: list[str] = []
    warnings: list[str] = []
    role_lines = [line for line in lines if ROLE_RE.search(line)]
    speech_lines = [line for line in lines if SPEECH_RE.search(line)]
    quotes = QUOTE_RE.findall(text)
    if len(text) < 120:
        errors.append("提示词过短，缺少角色、声音环境和对白结构。")
    if not role_lines:
        errors.append("没有检测到角色声线清单。每个角色需要写年龄/性别、口音、声线或音色。")
    if not speech_lines:
        errors.append("没有检测到带说话人的引号台词。每句对白必须明确说话人并使用中文引号。")
    if not SOUND_RE.search(text):
        errors.append("没有检测到环境声、音乐或音效设计。")
    common_checks(text, require_hk, errors, warnings)
    if len(quotes) < len(speech_lines):
        warnings.append("部分对白可能没有使用成对中文引号，请人工检查。")
    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "stats": {"kind": "scene-master", "characters": len(text), "role_lines": len(role_lines), "speech_lines": len(speech_lines), "quoted_lines": len(quotes)},
    }


def lint(prompt: str, require_hk: bool, kind: str = "scene-master") -> dict[str, object]:
    text = prompt.strip()
    return lint_voice_anchor(text, require_hk) if kind == "voice-anchor" else lint_scene_master(text, require_hk)


def auto_requires_hk(text: str) -> bool:
    if re.search(r"90年代香港|九十年代香港|香港电影|港片", text):
        return True
    return re.search(r"(?:使用|采用|说|口音为|明确为)港式普通话", text) is not None and re.search(r"不带|禁止|不要|不得.*港式普通话", text) is None


def self_test() -> None:
    scene_master = """角色声线清单：
林姐是三十多岁女性，贵州普通话，声音温暖但利落，中低声线，语速中等，咬字清楚。
阿杰是二十多岁男性，普通话略带本地口音，声线偏亮，前半段语速较快，后半段放慢。
声音环境与音乐：夜间洗护店内有轻微设备低鸣、门外细雨声，低音量木吉他只作情绪铺底。
按顺序对白与音效：门铃轻响一次。林姐压低音量、停顿半秒后说道：“鞋已经洗好了，你先看看细节。”
阿杰先惊讶吸气，随后放慢语速回应：“这双鞋原来还能这么干净？”结尾保留一秒雨声，不再加对白。"""
    anchor = """小曼是十六到十八岁的女高中生，使用标准普通话，不带港式口音，声线年轻清亮，音高中等偏高，音色柔和但不幼态，语速中等，音量自然，咬字清楚。
这是4到5秒的单角色干声音色样本：无音乐、无环境声、无音效、无混响，不模仿任何具体演员。
小曼先停顿半拍，再轻声说：“今天的阳光，好像比昨天暖一点。”"""
    bad = "用稳定、清晰、自然的普通话说：鞋洗好了。"
    contaminated = anchor.replace("无音乐", "有背景音乐")
    assert lint(scene_master, require_hk=False, kind="scene-master")["ok"], lint(scene_master, False, "scene-master")
    assert lint(anchor, require_hk=False, kind="voice-anchor")["ok"], lint(anchor, False, "voice-anchor")
    assert not lint(bad, require_hk=False, kind="voice-anchor")["ok"]
    assert not lint(contaminated, require_hk=False, kind="voice-anchor")["ok"]
    assert not lint(scene_master, require_hk=True, kind="scene-master")["ok"]
    print("doubao audio prompt_lint self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser(description="检查豆包纯文本音频提示词结构")
    parser.add_argument("prompt", nargs="?", help="提示词文件；省略时从 stdin 读取")
    parser.add_argument("--style", choices=("hk90", "generic", "auto"), default="auto", help="项目风格检查；auto按提示词中的剧本风格判断")
    parser.add_argument("--kind", choices=("voice-anchor", "scene-master"), default="scene-master", help="检查角色音色锚点或历史场景母带")
    parser.add_argument("--self-test", action="store_true", help="运行内置正反例回归测试")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    text = Path(args.prompt).read_text(encoding="utf-8") if args.prompt else sys.stdin.read()
    require_hk = args.style == "hk90" or (args.style == "auto" and auto_requires_hk(text))
    result = lint(text, require_hk=require_hk, kind=args.kind)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
