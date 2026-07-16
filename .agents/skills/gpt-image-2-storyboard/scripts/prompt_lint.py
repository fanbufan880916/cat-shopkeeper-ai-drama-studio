#!/usr/bin/env python3
import argparse
import pathlib
import re
import sys

REQUIRED_GROUPS = {
    "画面用途": ["设定图", "首帧", "分镜", "场景", "道具", "海报", "重绘", "reference sheet", "design sheet"],
    "主体身份": ["角色", "人物", "主体", "猫", "男性", "女性", "场景", "道具", "character"],
    "构图视角": ["构图", "景别", "视角", "机位", "特写", "中景", "全景", "三视图", "多视图", "拼版"],
    "光线": ["光", "照明", "夕阳", "窗光", "灯", "棚光", "studio light"],
    "色彩材质": ["色", "材质", "质感", "纹理", "调色", "color", "fabric"],
    "连续性": ["保持", "延续", "一致", "不要改变", "禁止变化", "same face", "identity"],
}

SLOP = ["顶级", "极致", "震撼", "梦幻", "电影级", "8k", "杰作", "best quality"]

CHARACTER_SHEET_MARKERS = [
    "角色设定图",
    "角色设计参考",
    "角色设计参考拼版",
    "character design reference",
    "character design sheet",
    "character reference sheet",
    "角色参考拼版",
]


def is_character_sheet(prompt: str) -> bool:
    lower = prompt.lower()
    if any(marker.lower() in lower for marker in CHARACTER_SHEET_MARKERS):
        return True
    # 明确写了左右分区的角色设计，也按角色设定图处理
    has_face = any(word in prompt for word in ["脸部特写", "面部特写", "头肩特写", "face close-up", "face closeup"])
    has_turnaround = any(word in lower for word in ["三视图", "多视图", "turnaround", "front side back"])
    return has_face and has_turnaround


def has_left_face_panel(prompt: str) -> bool:
    lower = prompt.lower()
    patterns = [
        r"左[侧边]?\s*约?\s*40\s*%",
        r"左侧\s*40",
        r"left\s*(?:about\s*)?40\s*%",
        r"左[侧边].{0,12}(脸部特写|面部特写|头肩特写|face)",
        r"(face close-?up|面部特写|脸部特写).{0,20}(左|left)",
    ]
    return any(re.search(p, lower if "left" in p or "face close" in p else prompt, re.I) for p in patterns) or (
        ("左" in prompt or "left" in lower) and any(w in prompt.lower() for w in ["脸部特写", "面部特写", "头肩特写", "face close-up", "face closeup"])
    )


def has_right_turnaround(prompt: str) -> bool:
    lower = prompt.lower()
    has_right = bool(re.search(r"右[侧边]?\s*约?\s*60\s*%|右侧\s*60|right\s*(?:about\s*)?60\s*%|右[侧边]", prompt, re.I))
    has_front = any(w in prompt for w in ["正面", "front"])
    has_side = any(w in prompt for w in ["侧面", "side"])
    has_back = any(w in prompt for w in ["背面", "后视", "back view", "rear"])
    has_full = any(w in prompt for w in ["全身", "full body", "full-body", "turnaround", "三视图", "多视图"])
    return has_right and has_front and has_side and has_back and has_full


def has_face_lock(prompt: str) -> bool:
    lower = prompt.lower()
    keys = [
        "脸部特写与三视图",
        "面部完全一致",
        "不要改变脸",
        "不要改变脸型",
        "保持脸型",
        "same face",
        "face consistent",
        "identity consistent",
        "左右同一角色",
        "同一角色",
    ]
    return any(k.lower() in lower for k in keys)


def lint(prompt: str, aspect: str):
    issues = []
    for label, words in REQUIRED_GROUPS.items():
        if not any(word.lower() in prompt.lower() for word in words):
            issues.append(f"缺少{label}")
    if aspect and aspect not in prompt:
        issues.append(f"未写明画幅 {aspect}")
    if len(prompt.strip()) < 80:
        issues.append("提示词过短，无法稳定约束漫剧画面")
    slop_count = sum(prompt.lower().count(word.lower()) for word in SLOP)
    if slop_count >= 4:
        issues.append("空泛质量词过多，请改成可见的画面说明")

    character_sheet = is_character_sheet(prompt)
    multi_view = any(w in prompt.lower() for w in ["三视图", "多视图", "turnaround", "正面", "侧面", "背面"]) and (
        "三视图" in prompt or "多视图" in prompt or "turnaround" in prompt.lower() or has_right_turnaround(prompt)
    )

    if character_sheet:
        if not has_left_face_panel(prompt):
            issues.append("角色设定图必须明确左侧约40%脸部特写")
        if not has_right_turnaround(prompt):
            issues.append("角色设定图必须明确右侧约60%正面/侧面/背面全身三视图")
        if not has_face_lock(prompt):
            issues.append("角色设定图必须要求左右同一角色且脸部不漂移")
        if aspect and aspect not in ("3:2", "16:9") and aspect not in prompt:
            issues.append("角色设定图建议使用 3:2 横向画幅")
        if any(w in prompt for w in ["港风", "90年代香港", "90s Hong Kong", "Wong Kar-wai", "王家卫", "霓虹冷暖", "anamorphic"]):
            issues.append("角色设定图禁止写成戏剧风格分镜；戏剧光效应留给分镜首帧")
    else:
        # 非角色拼版时，同时硬性要求正反面而无多视图才可能冲突
        if "正面" in prompt and "背面" in prompt and not multi_view:
            issues.append("视角可能冲突：同时要求正面和背面，请改成角色三视图拼版或只保留一个主视角")

    if "资产 ID" in prompt or "资产ID" in prompt or "用于《" in prompt:
        issues.append("提示词混入工作台管理信息；资产 ID、项目名和用途关系应放在结构化字段中")
    return issues


def self_test():
    good_character = (
        "角色设定图，角色设计参考拼版，3:2横向构图。"
        "左侧约40%是同一角色的脸部特写，锁定五官、脸型和发型。"
        "右侧约60%是同一角色的全身三视图并排：正面全身、侧面全身、背面全身。"
        "成年拟人猫，圆脸、黑银虎斑、红色围裙，浅灰中性背景，柔和均匀棚光，棉布质感清楚。"
        "左右同一角色，脸部特写与三视图面部完全一致；不要改变脸型、五官比例、发型和服装配色。"
    )
    good_scene = (
        "场景设定图，保持老城区街巷的青石地面、木质门楣、砖墙肌理和黄昏窗光一致。"
        "16:9 横构图，广角全景，无人物，自然窗光从右侧斜入，暖石色与木材质感清楚，地面湿润反光克制，"
        "空间层次完整可比较，不要改变空间结构、主色和关键材质。"
    )
    bad = "电影级顶级极致震撼8k杰作，一个人。"
    bad_character = (
        "角色设定图，17岁女生校服，9:16电影静帧，站在雨夜霓虹下，王家卫质感。"
        "保持脸型一致，中景构图，柔和灯光，肤色清楚。"
    )

    assert not lint(good_character, "3:2"), lint(good_character, "3:2")
    assert not lint(good_scene, "16:9"), lint(good_scene, "16:9")
    assert lint(bad, "9:16")
    character_issues = lint(bad_character, "9:16")
    assert any("左" in issue or "40" in issue for issue in character_issues), character_issues
    assert any("三视图" in issue or "60" in issue for issue in character_issues), character_issues
    print("prompt_lint self-test: PASS")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt-file", type=pathlib.Path)
    parser.add_argument("--aspect", default="")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if not args.prompt_file:
        parser.error("--prompt-file is required unless --self-test is used")
    issues = lint(args.prompt_file.read_text(encoding="utf-8"), args.aspect)
    if issues:
        for issue in issues:
            print(f"ERROR: {issue}")
        return 1
    print("prompt_lint: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
