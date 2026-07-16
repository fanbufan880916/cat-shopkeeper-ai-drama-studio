import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, CircleHelp, Clapperboard, CloudDownload, ExternalLink, Film, Images, KeyRound, LayoutDashboard, ListChecks, LockKeyhole, Plus, RefreshCcw, ScrollText, ShieldCheck, Sparkles, Upload, Users, Video, Volume2, X } from "lucide-react";
import clsx from "clsx";
import { api } from "./api";
import { getAudioConfirmationProgress } from "./audio-confirmation";
import { globalSettingsRoute, projectRoute } from "./navigation";
import { canAccessSection, getNavigationState, getSectionUnlockReason, getStageAction, sectionPath, type WorkspaceSection } from "./workflow-ui";
import { assetImageSize, isActiveAssetResultJob } from "./asset-generation";
import { assetUiStatusLabels, filterAndSortAssets, getAssetUiStatus, type AssetUiStatus } from "./asset-ui";
import { codexTaskObject, sortTasks, taskObject } from "./task-ui";
import { cleanImagePrompt } from "../shared/image-prompt";
import { imageModelOption, imageModelOptions, imageModelParams, imageResolutionLabel } from "../shared/image-models";
import { videoModelOption, videoModelOptions, type VideoResolution } from "../shared/video-models";
import { audioPromptContextFromScript, audioStyleLabels, buildAudioPrompt, inferAudioStyleProfile, validateAudioPrompt } from "../shared/audio-prompt";
import { buildAutomaticAudioSegments } from "../shared/audio-segments";
import { extractLockedScriptDialogue, latestLockedScript } from "../shared/script-dialogue";
import type { ContentMode, DashboardData, Project } from "../shared/types";
import { stageLabels, workflowStages } from "../shared/types";
import type { WorkbenchUpdateStatus } from "../shared/workbench-update";

function App() {
  const location = useLocation();
  const [guideOpen, setGuideOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  useEffect(() => {
    if (localStorage.getItem("cat-studio-onboarding-v1") !== "completed") setGuideOpen(true);
  }, []);
  const closeGuide = () => {
    localStorage.setItem("cat-studio-onboarding-v1", "completed");
    setGuideOpen(false);
  };
  return (
    <>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/project/:projectId/*" element={<Studio />} />
      </Routes>
      <div className={clsx("workbench-utility-bar", location.pathname === "/settings" && "settings-offset")} aria-label="工作台帮助与更新">
        <button className="ghost" onClick={() => { setUpdateOpen(false); setGuideOpen(true); }}><CircleHelp size={17} />新人指引</button>
        <button className="update-entry" onClick={() => { setGuideOpen(false); setUpdateOpen(true); }}><CloudDownload size={17} />检查更新</button>
      </div>
      {guideOpen && <OnboardingGuide onClose={closeGuide} />}
      {updateOpen && <WorkbenchUpdateDialog onClose={() => setUpdateOpen(false)} />}
    </>
  );
}

function DialogShell({ titleId, title, description, onClose, children }: {
  titleId: string;
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? []);
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);
  return (
    <div className="workbench-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="workbench-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`}>
        <header>
          <div><h2 id={titleId}>{title}</h2><p id={`${titleId}-description`}>{description}</p></div>
          <button className="dialog-close" aria-label={`关闭${title}`} onClick={onClose}><X size={20} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

const onboardingSteps = [
  {
    icon: Clapperboard,
    title: "欢迎来到猫掌柜漫剧工作台",
    description: "用大约 2 分钟认识最重要的制作规则，然后直接开始真实项目。",
    points: ["工作台会把创意、剧本、资产、分镜和成片串成一条流程。", "你始终只需要处理页面上标出的“当前任务”。"]
  },
  {
    icon: Plus,
    title: "第一步：把创作目标写完整",
    description: "先创建项目，填写受众、传播目的、目标情绪、平台和时长。",
    points: ["这些信息会成为所有 Agent 的共同创作依据。", "旧项目可以继续使用；新项目会在缺少关键目标时提醒你补全。"]
  },
  {
    icon: LayoutDashboard,
    title: "第二步：只沿着当前任务推进",
    description: "总览页只有一个主按钮，左侧导航会显示已完成、当前和未解锁阶段。",
    points: ["先审剧本，再做资产，资产通过后才进入分镜。", "未来阶段被锁定时，页面会告诉你缺少什么以及应该去哪里处理。"]
  },
  {
    icon: ShieldCheck,
    title: "第三步：先样片，确认后再批量",
    description: "真实生图、生视频和音频可能产生费用，只有你在页面点击生成按钮才会提交。",
    points: ["API Key 只保存在本机，不会上传到 GitHub。", "右上角可随时重看本指引，也可以检查并拉取工作台更新。"]
  }
] as const;

function OnboardingGuide({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const item = onboardingSteps[step];
  const Icon = item.icon;
  const finish = () => {
    onClose();
    navigate("/");
  };
  return (
    <DialogShell titleId="onboarding-title" title="新人指引" description={`第 ${step + 1} 步，共 ${onboardingSteps.length} 步`} onClose={onClose}>
      <div className="onboarding-progress" aria-label={`新人指引进度：${step + 1}/${onboardingSteps.length}`}>
        {onboardingSteps.map((entry, index) => <span key={entry.title} className={clsx(index <= step && "active")} />)}
      </div>
      <div className="onboarding-content">
        <div className="onboarding-icon"><Icon size={30} /></div>
        <h3>{item.title}</h3>
        <p>{item.description}</p>
        <ul>{item.points.map((point) => <li key={point}>{point}</li>)}</ul>
      </div>
      <footer className="dialog-actions">
        <button className="ghost" onClick={onClose}>跳过，以后再看</button>
        <div className="button-row">
          {step > 0 && <button className="ghost" onClick={() => setStep((value) => value - 1)}><ArrowLeft size={16} />上一步</button>}
          {step < onboardingSteps.length - 1
            ? <button className="primary" onClick={() => setStep((value) => value + 1)}>下一步<ArrowRight size={16} /></button>
            : <button className="primary" onClick={finish}><Check size={16} />开始使用工作台</button>}
        </div>
      </footer>
    </DialogShell>
  );
}

function UpdateStatusSummary({ status }: { status: WorkbenchUpdateStatus }) {
  const labels: Record<WorkbenchUpdateStatus["state"], string> = {
    current: "已经是最新版本",
    available: "发现可用更新",
    dirty: "本地有未提交修改",
    ahead: "本地版本领先 GitHub",
    diverged: "本地与 GitHub 已分叉",
    unavailable: "当前不能自动更新"
  };
  return (
    <section className={clsx("update-status-card", `state-${status.state}`)} aria-live="polite">
      <div><strong>{labels[status.state]}</strong><span>V{status.version} · {status.branch || "未识别分支"}</span></div>
      <p>{status.message}</p>
      {status.localCommit && <dl><div><dt>本地版本</dt><dd>{status.localCommit}</dd></div><div><dt>GitHub 版本</dt><dd>{status.remoteCommit}</dd></div></dl>}
    </section>
  );
}

function WorkbenchUpdateDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<WorkbenchUpdateStatus | null>(null);
  const [busy, setBusy] = useState<"loading" | "checking" | "updating" | "">("loading");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.updateStatus()
      .then((result) => { if (active) setStatus(result); })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setBusy(""); });
    return () => { active = false; };
  }, []);
  async function check() {
    setBusy("checking"); setError("");
    try { setStatus(await api.checkUpdate()); } catch (reason) { setError((reason as Error).message); } finally { setBusy(""); }
  }
  async function update() {
    if (!status?.canUpdate) return;
    if (!window.confirm(`确认从 GitHub 拉取 ${status.behind} 个更新？\n\n工作台只会执行安全快进更新，不会覆盖未提交的本地修改。更新后需要重新启动工作台。`)) return;
    setBusy("updating"); setError("");
    try { setStatus(await api.applyUpdate()); } catch (reason) { setError((reason as Error).message); } finally { setBusy(""); }
  }
  return (
    <DialogShell titleId="workbench-update-title" title="工作台更新" description="从当前 GitHub 仓库安全检查并拉取新版本。" onClose={onClose}>
      <div className="update-dialog-content">
        <div className="update-safety-note"><ShieldCheck size={22} /><p><strong>不会上传 API Key 或项目数据</strong><span>更新只处理 Git 管理的程序文件；`.data`、媒体、备份和密钥目录不会参与拉取。</span></p></div>
        {busy === "loading" && <div className="update-loading">正在读取本地版本…</div>}
        {status && <UpdateStatusSummary status={status} />}
        {status?.repositoryUrl && <a className="repository-link" href={status.repositoryUrl} target="_blank" rel="noreferrer">查看公开 GitHub 仓库<ExternalLink size={15} /></a>}
        {status?.restartRequired && <div className="update-restart-note" role="status"><Check size={20} /><p><strong>更新和构建已经完成</strong><span>请关闭本页并重新双击“启动工作台.cmd”，服务端新功能才会全部生效。</span></p></div>}
        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
      <footer className="dialog-actions">
        <button className="ghost" onClick={onClose}>{status?.restartRequired ? "完成" : "关闭"}</button>
        <div className="button-row">
          <button className="ghost" disabled={Boolean(busy)} onClick={() => void check()}><RefreshCcw size={16} />{busy === "checking" ? "正在检查…" : "检查 GitHub 更新"}</button>
          {status?.canUpdate && <button className="primary" disabled={Boolean(busy)} onClick={() => void update()}><CloudDownload size={16} />{busy === "updating" ? "正在拉取并构建…" : "立即更新"}</button>}
        </div>
      </footer>
    </DialogShell>
  );
}

function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contentMode, setContentMode] = useState<ContentMode>("short_film");
  const [targetAudience, setTargetAudience] = useState("");
  const [creativePurpose, setCreativePurpose] = useState("");
  const [targetEmotion, setTargetEmotion] = useState("");
  const [targetPlatform, setTargetPlatform] = useState("douyin");
  const [customPlatform, setCustomPlatform] = useState("");
  const [targetDuration, setTargetDuration] = useState(60);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const fieldRefs = {
    name: useRef<HTMLInputElement>(null), description: useRef<HTMLTextAreaElement>(null),
    targetAudience: useRef<HTMLInputElement>(null), creativePurpose: useRef<HTMLInputElement>(null),
    targetEmotion: useRef<HTMLInputElement>(null), targetPlatform: useRef<HTMLSelectElement>(null)
  };
  const navigate = useNavigate();
  const load = useCallback(() => api.projects().then(setProjects).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  async function create() {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "请填写项目名称。";
    if (!description.trim()) errors.description = "请用大白话写下创意简报。";
    if (!targetAudience.trim()) errors.targetAudience = "请说明这条内容主要拍给谁看。";
    if (!creativePurpose.trim()) errors.creativePurpose = "请说明希望传播什么或促成什么行动。";
    if (!targetEmotion.trim()) errors.targetEmotion = "请说明希望观众看完产生什么主要情绪。";
    if (targetPlatform === "custom" && !customPlatform.trim()) errors.targetPlatform = "选择自定义平台后，请填写平台名称。";
    setFieldErrors(errors);
    const firstError = ["name", "description", "targetAudience", "creativePurpose", "targetEmotion", "targetPlatform"].find((key) => errors[key]);
    if (firstError) {
      fieldRefs[firstError as keyof typeof fieldRefs].current?.focus();
      return;
    }
    setCreating(true); setError("");
    try {
      const project = await api.createProject({
        name: name.trim(), description: description.trim(), contentMode,
        targetAudience: targetAudience.trim(), creativePurpose: creativePurpose.trim(), targetEmotion: targetEmotion.trim(),
        targetPlatform: targetPlatform === "custom" ? customPlatform.trim() : targetPlatform, targetDuration
      });
      navigate(`/project/${project.id}`);
    } catch (e) { setError((e as Error).message); } finally { setCreating(false); }
  }
  function clearFieldError(key: string) {
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  return (
    <main className="landing">
      <section className="hero-panel">
        <div className="brand-mark"><Clapperboard /></div>
        <p className="eyebrow">CAT SHOPKEEPER FILM LAB</p>
        <h1>猫掌柜 AI 漫剧创作工作台</h1>
        <p className="hero-copy">从一个创意开始，完成剧本审查、角色资产、电影分镜、AI 生图和 Seedance 视频制作。</p>
        <div className="new-project">
          <div className="creative-step-label"><span>01</span><div><strong>先决定你要拍什么</strong><small>内容类型会影响剧本、节奏、审核和交付方式</small></div></div>
          <div className="mode-picker" role="radiogroup" aria-label="内容类型">
            <button type="button" role="radio" aria-checked={contentMode === "short_film"} className={clsx("mode-option", contentMode === "short_film" && "selected")} onClick={() => setContentMode("short_film")}><Film size={17} /><span><b>剧情短片</b><small>人物、冲突与余味</small></span></button>
            <button type="button" role="radio" aria-checked={contentMode === "ad"} className={clsx("mode-option", contentMode === "ad" && "selected")} onClick={() => setContentMode("ad")}><Sparkles size={17} /><span><b>创意广告</b><small>卖点、记忆与行动</small></span></button>
            <button type="button" role="radio" aria-checked={contentMode === "mv"} className={clsx("mode-option", contentMode === "mv" && "selected")} onClick={() => setContentMode("mv")}><Volume2 size={17} /><span><b>音乐 MV</b><small>歌词、节拍与意象</small></span></button>
          </div>
          <div className="creative-step-label"><span>02</span><div><strong>给导演一份完整简报</strong><small>受众、目的和情绪会成为所有 Agent 的共同创作依据</small></div></div>
          <label>项目名称<input ref={fieldRefs.name} value={name} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "project-name-error" : undefined} onChange={(e) => { setName(e.target.value); clearFieldError("name"); }} placeholder="例如：猫掌柜的雨夜奇遇" />{fieldErrors.name && <small id="project-name-error" className="field-error" role="alert">{fieldErrors.name}</small>}</label>
          <label>创意简报<textarea ref={fieldRefs.description} value={description} aria-invalid={Boolean(fieldErrors.description)} aria-describedby={fieldErrors.description ? "project-brief-error" : undefined} onChange={(e) => { setDescription(e.target.value); clearFieldError("description"); }} placeholder="用大白话写清楚人物、事件、卖点或你最想表达的内容。" />{fieldErrors.description && <small id="project-brief-error" className="field-error" role="alert">{fieldErrors.description}</small>}</label>
          <label>目标受众<input ref={fieldRefs.targetAudience} value={targetAudience} aria-invalid={Boolean(fieldErrors.targetAudience)} aria-describedby={fieldErrors.targetAudience ? "project-audience-error" : undefined} onChange={(e) => { setTargetAudience(e.target.value); clearFieldError("targetAudience"); }} placeholder="例如：18—35岁六盘水本地年轻人" />{fieldErrors.targetAudience && <small id="project-audience-error" className="field-error" role="alert">{fieldErrors.targetAudience}</small>}</label>
          <label>传播或转化目的<input ref={fieldRefs.creativePurpose} value={creativePurpose} aria-invalid={Boolean(fieldErrors.creativePurpose)} aria-describedby={fieldErrors.creativePurpose ? "project-purpose-error" : undefined} onChange={(e) => { setCreativePurpose(e.target.value); clearFieldError("creativePurpose"); }} placeholder="例如：引导购买9.9元洗鞋团购券" />{fieldErrors.creativePurpose && <small id="project-purpose-error" className="field-error" role="alert">{fieldErrors.creativePurpose}</small>}</label>
          <label>目标情绪<input ref={fieldRefs.targetEmotion} value={targetEmotion} aria-invalid={Boolean(fieldErrors.targetEmotion)} aria-describedby={fieldErrors.targetEmotion ? "project-emotion-error" : undefined} onChange={(e) => { setTargetEmotion(e.target.value); clearFieldError("targetEmotion"); }} placeholder="例如：先好奇，最后温暖并愿意行动" />{fieldErrors.targetEmotion && <small id="project-emotion-error" className="field-error" role="alert">{fieldErrors.targetEmotion}</small>}</label>
          <div className="brief-row">
            <label>目标平台<select ref={fieldRefs.targetPlatform} value={targetPlatform} aria-invalid={Boolean(fieldErrors.targetPlatform)} onChange={(e) => { setTargetPlatform(e.target.value); clearFieldError("targetPlatform"); }}><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option><option value="wechat_channels">微信视频号</option><option value="kuaishou">快手</option><option value="bilibili">B站</option><option value="custom">自定义</option></select>{targetPlatform === "custom" && <input value={customPlatform} onChange={(e) => { setCustomPlatform(e.target.value); clearFieldError("targetPlatform"); }} placeholder="填写平台名称" />}{fieldErrors.targetPlatform && <small className="field-error" role="alert">{fieldErrors.targetPlatform}</small>}</label>
            <label>目标时长<select value={targetDuration} onChange={(e) => setTargetDuration(Number(e.target.value))}><option value={15}>15 秒</option><option value={30}>30 秒</option><option value={60}>60 秒</option><option value={90}>90 秒</option></select></label>
          </div>
          <section className="project-create-summary" aria-label="创建前摘要"><strong>创建前确认</strong><span>{contentMode === "short_film" ? "剧情短片" : contentMode === "ad" ? "创意广告" : "音乐 MV"} · {targetPlatform === "custom" ? customPlatform || "自定义平台" : targetPlatform === "douyin" ? "抖音" : targetPlatform === "xiaohongshu" ? "小红书" : targetPlatform === "wechat_channels" ? "微信视频号" : targetPlatform === "kuaishou" ? "快手" : "B站"} · {targetDuration} 秒</span><p>{targetAudience || "待填写受众"} → {creativePurpose || "待填写目的"} → {targetEmotion || "待填写目标情绪"}</p></section>
          <div className="creative-submit-note"><span>03</span><p>创建后，导演 Agent 会先检查钩子、受众和视觉风格，再进入剧本阶段。</p></div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="primary" disabled={creating} onClick={create}><Plus size={18} />{creating ? "正在创建…" : "创建项目"}</button>
        </div>
      </section>
      <section className="project-grid">
        <div className="section-heading"><div><p className="eyebrow">PROJECT LIBRARY</p><h2>已有项目</h2></div><button className="ghost" onClick={load}><RefreshCcw size={16} /> 刷新</button></div>
        {projects.length === 0 ? <div className="empty-card">还没有项目，从左侧创建第一个漫剧。</div> : projects.map((project) => (
          <button className={clsx("project-card", project.dryRun && "dry-run-project")} key={project.id} onClick={() => navigate(`/project/${project.id}`)}>
            <div className="project-poster"><Film size={34} /><span>{project.aspectRatio}</span></div>
            <div><h3>{project.name}</h3>{project.dryRun && <span className="dry-run-badge">空跑测试 · 零API费用</span>}<p>{project.description || "暂无创意简介"}</p><div className="card-meta"><span>{stageLabels[project.stage]}</span><span>{project.targetDuration} 秒</span></div></div>
          </button>
        ))}
      </section>
    </main>
  );
}

const navigation = [
  ["dashboard", "", "总览", LayoutDashboard], ["script", "script", "剧本审片", ScrollText], ["assets", "assets", "资产中心", Users],
  ["audio", "audio", "声音生产", Volume2], ["storyboard", "storyboard", "分镜生产", Clapperboard],
  ["jobs", "jobs", "任务中心", ListChecks], ["preview", "preview", "成片预览", Film]
] as const;

function Studio() {
  const { projectId = "" } = useParams();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { try { setData(await api.project(projectId)); setError(""); } catch (e) { setError((e as Error).message); } }, [projectId]);
  useEffect(() => { void load(); const source = new EventSource("/api/events"); source.addEventListener("project.updated", load); source.addEventListener("job.updated", load); return () => source.close(); }, [load]);
  if (!data) return <div className="center-screen">{error || "正在打开项目…"}</div>;
  const hasScript = data.artifacts.some((artifact) => artifact.type === "script");
  const audioConfirmation = getAudioConfirmationProgress(
    extractLockedScriptDialogue(data.artifacts, data.shots),
    data.audioClips,
    data.shots
  );
  return (
    <div className="studio-shell">
      <aside className="sidebar">
        <NavLink to="/" className="sidebar-brand"><div className="brand-mark small"><Clapperboard /></div><div><strong>猫掌柜</strong><span>AI 漫剧工作台</span></div></NavLink>
        <nav aria-label="项目制作导航">{navigation.map(([section, path, label, Icon]) => {
          const state = getNavigationState(data.project.stage, section, hasScript, { audio: audioConfirmation.complete });
          const content = <><Icon size={18} /><span className="nav-item-copy"><b>{label}</b>{state === "locked" && <small>{getSectionUnlockReason(section)}</small>}</span>{state === "locked" ? <LockKeyhole className="nav-state-icon" size={14} /> : state === "completed" ? <Check className="nav-state-icon" size={14} /> : null}</>;
          return state === "locked"
            ? <span key={label} className="nav-item locked" aria-disabled="true" title={getSectionUnlockReason(section)}>{content}</span>
            : <NavLink key={label} end={!path} to={projectRoute(projectId, path)} className={({ isActive }) => clsx("nav-item", `nav-${state}`, isActive && "active")}>{content}</NavLink>;
        })}
          <NavLink to={globalSettingsRoute(projectRoute(projectId))} className="nav-item"><KeyRound size={18} /><span className="nav-item-copy"><b>API 设置</b><small>适用于所有项目</small></span></NavLink>
        </nav>
        <div className="sidebar-footer"><span>当前项目</span><strong>{data.project.name}</strong><small>{stageLabels[data.project.stage]}</small></div>
      </aside>
      <main className="workspace">
        {data.project.dryRun && <section className="dry-run-banner" role="status"><strong>空跑测试项目</strong><span>图片和视频只会生成本地 Mock 占位素材，不调用 Codex、APIMart、Seedance 或豆包音频 API，也不能用于判断真实画质。</span></section>}
        {error && <div className="alert error-text">{error}</div>}
        <Routes>
          <Route index element={<Dashboard data={data} />} />
          <Route path="script" element={<StageGate data={data} section="script"><ScriptPage data={data} reload={load} /></StageGate>} />
          <Route path="assets" element={<StageGate data={data} section="assets"><AssetsPage data={data} reload={load} /></StageGate>} />
          <Route path="storyboard" element={<StageGate data={data} section="storyboard"><StoryboardPage data={data} reload={load} /></StageGate>} />
          <Route path="audio" element={<StageGate data={data} section="audio"><AudioProductionPageWithLibrary data={data} reload={load} /></StageGate>} />
          <Route path="images" element={<Navigate replace to={projectRoute(projectId, "assets")} />} />
          <Route path="videos" element={<Navigate replace to={projectRoute(projectId, "storyboard")} />} />
          <Route path="jobs" element={<JobsPage data={data} reload={load} />} />
          <Route path="preview" element={<StageGate data={data} section="preview"><PreviewPage data={data} reload={load} /></StageGate>} />
          <Route path="skills" element={<Navigate replace to={projectRoute(projectId, "storyboard")} />} />
          <Route path="settings" element={<Navigate replace to={globalSettingsRoute(projectRoute(projectId))} />} />
        </Routes>
      </main>
    </div>
  );
}

function StageGate({ data, section, children }: { data: DashboardData; section: WorkspaceSection; children: React.ReactNode }) {
  const navigate = useNavigate();
  const hasScript = data.artifacts.some((artifact) => artifact.type === "script");
  if (canAccessSection(data.project.stage, section, hasScript)) return children;
  const action = getStageAction(data.project.stage);
  const destination = canAccessSection(data.project.stage, action.section, hasScript) ? sectionPath(action.section) : "";
  return <>
    <PageHeader eyebrow="STAGE LOCK" title="这个制作阶段尚未解锁" description={getSectionUnlockReason(section)} />
    <section className="panel stage-lock-panel">
      <LockKeyhole size={30} />
      <div><h2>当前任务：{stageLabels[data.project.stage]}</h2><p>先完成当前任务，工作台才会开放后续操作。直接输入未来阶段地址也不会加载写操作页面。</p></div>
      <button className="primary" onClick={() => navigate(projectRoute(data.project.id, destination))}>返回当前任务 · {action.label}</button>
    </section>
  </>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions && <div className="header-actions">{actions}</div>}</header>;
}

function Dashboard({ data }: { data: DashboardData }) {
  const navigate = useNavigate();
  const stageIndex = workflowStages.indexOf(data.project.stage);
  const action = getStageAction(data.project.stage);
  const hasScript = data.artifacts.some((artifact) => artifact.type === "script");
  const actionAvailable = canAccessSection(data.project.stage, action.section, hasScript);
  const completed = data.jobs.filter((job) => job.status === "completed").length;
  const pending = data.jobs.filter((job) => ["draft", "submitted", "processing"].includes(job.status)).length;
  const cost = data.jobs.reduce((sum, job) => sum + job.cost, 0);
  const [contentMode, setContentMode] = useState<ContentMode>(data.project.contentMode);
  const [targetPlatform, setTargetPlatform] = useState(data.project.targetPlatform);
  const [targetAudience, setTargetAudience] = useState(data.project.targetAudience);
  const [creativePurpose, setCreativePurpose] = useState(data.project.creativePurpose);
  const [targetEmotion, setTargetEmotion] = useState(data.project.targetEmotion);
  const [styleName, setStyleName] = useState(data.project.visualStyle.name);
  const [styleDescriptors, setStyleDescriptors] = useState(data.project.visualStyle.descriptors.join("、"));
  const [profileMessage, setProfileMessage] = useState("");
  useEffect(() => {
    setContentMode(data.project.contentMode);
    setTargetPlatform(data.project.targetPlatform);
    setTargetAudience(data.project.targetAudience);
    setCreativePurpose(data.project.creativePurpose);
    setTargetEmotion(data.project.targetEmotion);
    setStyleName(data.project.visualStyle.name);
    setStyleDescriptors(data.project.visualStyle.descriptors.join("、"));
  }, [data.project]);
  async function saveProfile() {
    try {
      const descriptors = styleDescriptors.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);
      await api.setCreativeProfile(data.project.id, {
        contentMode, targetPlatform, targetAudience, creativePurpose, targetEmotion,
        visualStyle: { status: styleName.trim() ? "locked" : "needs_review", name: styleName.trim(), descriptors,
          evidence: "由总导演在创作档案中确认。", source: "user", sourceArtifactId: null }
      });
      setProfileMessage(styleName.trim() ? "创作档案已锁定。" : "已退回待确认，暂时不能提交真实图片或视频生成。");
    } catch (error) { setProfileMessage((error as Error).message); }
  }
  return <>
    <PageHeader eyebrow={data.project.dryRun ? "DRY RUN DIRECTOR'S DESK" : "DIRECTOR'S DESK"} title={data.project.name} description={data.project.description || "在 Codex 对话框输入创意，然后由总导演 Agent 启动创作流程。"} />
    <section className="stage-banner"><div><span>当前制作阶段</span><h2>{stageLabels[data.project.stage]}</h2><p>{action.description}</p></div><div className="stage-banner-action"><div className="stage-number">{String(stageIndex + 1).padStart(2, "0")}<small>/ {workflowStages.length}</small></div><button className="primary" disabled={!actionAvailable} title={actionAvailable ? action.description : getSectionUnlockReason(action.section)} onClick={() => navigate(projectRoute(data.project.id, sectionPath(action.section)))}>{action.label}</button></div></section>
    <section className="panel creative-goal-summary"><div><span>内容模式</span><strong>{data.project.contentMode === "short_film" ? "剧情短片" : data.project.contentMode === "ad" ? "创意广告" : "音乐 MV"}</strong></div><div><span>平台与时长</span><strong>{data.project.targetPlatform} · {data.project.targetDuration} 秒</strong></div><div><span>目标受众</span><strong>{data.project.targetAudience || "旧项目尚未补充"}</strong></div><div><span>传播/转化目的</span><strong>{data.project.creativePurpose || "旧项目尚未补充"}</strong></div><div><span>目标情绪</span><strong>{data.project.targetEmotion || "旧项目尚未补充"}</strong></div><div><span>视觉风格</span><strong>{data.project.visualStyle.name || "等待确认"}</strong></div></section>
    <section className="panel creative-profile-panel"><div className="section-heading"><div><p className="eyebrow">CREATIVE PROFILE</p><h2>创作档案与视觉风格</h2><p>风格必须来自剧本或你的明确确认；没有锁定时，工作台不会提交真实生图/生视频。</p></div><span className={data.project.visualStyle.status === "locked" ? "status completed" : "status failed"}>{data.project.visualStyle.status === "locked" ? "风格已锁定" : "待导演确认"}</span></div><div className="form-grid creative-profile-grid"><label>内容类型<select value={contentMode} onChange={(e) => setContentMode(e.target.value as ContentMode)}><option value="short_film">剧情短片</option><option value="ad">创意广告</option><option value="mv">音乐 MV</option></select></label><label>目标平台<input value={targetPlatform} onChange={(e) => setTargetPlatform(e.target.value)} /></label><label>目标受众<input value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} placeholder="旧项目可以按需补充" /></label><label>传播或转化目的<input value={creativePurpose} onChange={(e) => setCreativePurpose(e.target.value)} placeholder="旧项目可以按需补充" /></label><label>目标情绪<input value={targetEmotion} onChange={(e) => setTargetEmotion(e.target.value)} placeholder="旧项目可以按需补充" /></label><label>视觉风格名称<input value={styleName} onChange={(e) => setStyleName(e.target.value)} placeholder="例如：现代现实主义、纪实影像、90年代香港电影质感" /></label><label className="profile-style-description">视觉描述<textarea value={styleDescriptors} onChange={(e) => setStyleDescriptors(e.target.value)} placeholder="光线、色彩、镜头、材质、时代、服化道；每项用顿号分隔" /></label></div><div className="button-row"><button className="ghost" onClick={() => void saveProfile()}>保存并锁定创作档案</button>{profileMessage && <span className="notice" aria-live="polite">{profileMessage}</span>}</div></section>
    <section className="stat-grid"><Stat label="待处理退回" value={data.revisions.filter((r) => r.status !== "resolved").length} /><Stat label="生成中任务" value={pending} /><Stat label="已完成素材" value={completed} /><Stat label="累计生成费用" value={`$${cost.toFixed(2)}`} /></section>
    <section className="panel"><div className="section-heading"><div><p className="eyebrow">PRODUCTION PIPELINE</p><h2>制作流程</h2></div></div><div className="pipeline">{workflowStages.slice(0, -1).map((stage, index) => <div className={clsx("pipeline-step", index < stageIndex && "done", index === stageIndex && "current")} key={stage}><span>{index < stageIndex ? "✓" : index + 1}</span><p>{stageLabels[stage]}</p></div>)}</div></section>
    <section className="two-column"><div className="panel"><h2>最新退回意见</h2>{data.revisions.filter((r) => r.status !== "resolved").slice(0, 4).map((r) => <article className="list-row" key={r.id}><div><strong>{r.category}</strong><p>{r.feedback}</p></div><span className="status failed">待修改</span></article>)}{!data.revisions.some((r) => r.status !== "resolved") && <Empty text="目前没有待处理的退回项。" />}</div><div className="panel"><h2>最近生成任务</h2>{data.jobs.slice(0, 4).map((job) => <article className="list-row" key={job.id}><div><strong>{job.kind === "image" ? "图片" : "视频"} · {job.model}</strong><p>{job.prompt.slice(0, 60)}</p></div><Status value={job.status} /></article>)}{!data.jobs.length && <Empty text="还没有生成任务。建议先用 Mock 模式走通流程。" />}</div></section>
  </>;
}

function Stat({ label, value }: { label: string; value: string | number }) { return <div className="stat-card"><span>{label}</span><strong>{value}</strong></div>; }
function Empty({ text }: { text: string }) { return <div className="empty-inline">{text}</div>; }
function Status({ value }: { value: string }) { const label: Record<string, string> = { draft: "待提交", queued: "等待 Codex", submitted: "已提交", processing: "处理中", completed: "已完成", failed: "失败", cancelled: "已取消" }; return <span className={clsx("status", value)}>{label[value] ?? value}</span>; }

type ScreenplayCharacter = { name?: string; role?: string; traits?: string; objective?: string };
type ScreenplayScene = { beat?: number; time?: string; name?: string; action?: string; dialogue?: string[]; sound?: string };
type StructuredScreenplay = {
  title?: string;
  format?: string;
  logline?: string;
  theme?: string;
  characters?: ScreenplayCharacter[];
  scenes?: ScreenplayScene[];
  visualDirection?: Record<string, string>;
  finalLine?: string;
};

function isStructuredScreenplay(value: unknown): value is StructuredScreenplay {
  return Boolean(value && typeof value === "object" && ("scenes" in value || "characters" in value || "logline" in value));
}

function averageScore(scores: Record<string, number>) {
  const values = Object.values(scores);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function ScoreReport({ title, review }: { title: string; review?: DashboardData["reviews"][number] }) {
  if (!review) return <section className="review-report pending-report"><div className="review-report-heading"><strong>{title}</strong><Status value="draft" /></div><p>尚未提交审核报告。</p></section>;
  const average = averageScore(review.scores);
  return <section className="review-report">
    <div className="review-report-heading"><div><strong>{title}</strong><small>平均 {average.toFixed(1)} / 5</small></div><span className={clsx("review-badge", review.decision)}>{review.decision === "approved" ? "已通过" : "未通过"}</span></div>
    <div className="score-list compact">{Object.entries(review.scores).map(([item, score]) => <div key={item}><span>{item}</span><b className={clsx(score >= 4 && "good-score", score < 3 && "bad-score")}>{score.toFixed(1)}</b></div>)}</div>
    {review.feedback && <div className="review-feedback"><b>审核结论</b><p>{review.feedback}</p></div>}
  </section>;
}

function ScreenplayReader({ content }: { content: unknown }) {
  if (!isStructuredScreenplay(content)) return <div className="plain-screenplay">{typeof content === "string" ? content : "暂无可阅读的剧本内容。"}</div>;
  const directionLabels: Record<string, string> = { environment: "环境", texture: "影像质感", directingRule: "导演原则", productionConstraint: "制作限制" };
  return <article className="screenplay-reader">
    <header className="screenplay-cover">
      <p className="eyebrow">FINAL SCREENPLAY</p>
      <h2>{content.title || "未命名短片"}</h2>
      {content.format && <span>{content.format}</span>}
      {content.logline && <blockquote>{content.logline}</blockquote>}
      {content.theme && <p><b>戏剧核心：</b>{content.theme}</p>}
    </header>
    {content.characters?.length ? <section className="reader-section"><div className="reader-section-title"><Users size={18} /><h3>人物设定</h3></div><div className="character-grid">{content.characters.map((character, index) => <div className="character-card" key={`${character.name}-${index}`}><div className="character-index">{String(index + 1).padStart(2, "0")}</div><h4>{character.name}</h4><span>{character.role}</span><p>{character.traits}</p>{character.objective && <small><b>目标：</b>{character.objective}</small>}</div>)}</div></section> : null}
    {content.scenes?.length ? <section className="reader-section"><div className="reader-section-title"><Clapperboard size={18} /><h3>分段剧本</h3></div><div className="script-scenes">{content.scenes.map((scene, index) => <section className="script-scene" key={`${scene.beat}-${index}`}><aside><strong>{String(scene.beat ?? index + 1).padStart(2, "0")}</strong><span>{scene.time}</span></aside><div><h4>{scene.name}</h4>{scene.action && <p className="scene-action">{scene.action}</p>}{scene.dialogue?.length ? <div className="dialogue-list">{scene.dialogue.map((line, lineIndex) => { const [speaker, ...words] = line.split("："); return <p key={lineIndex}><b>{words.length ? speaker : "对白"}</b><span>{words.length ? words.join("：") : line}</span></p>; })}</div> : null}{scene.sound && <p className="sound-note"><b>声音</b>{scene.sound}</p>}</div></section>)}</div></section> : null}
    {content.visualDirection && <section className="reader-section"><div className="reader-section-title"><Film size={18} /><h3>导演与美术说明</h3></div><div className="direction-grid">{Object.entries(content.visualDirection).map(([key, value]) => <div key={key}><span>{directionLabels[key] || key}</span><p>{value}</p></div>)}</div></section>}
    {content.finalLine && <footer className="final-line"><span>结尾金句</span><strong>“{content.finalLine}”</strong></footer>}
  </article>;
}

function ScriptPage({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const latest = data.artifacts.find((item) => item.type === "script");
  const directorReview = data.reviews.find((review) => review.gate === "director" && (!latest || review.artifactId === latest.id));
  const audienceReview = data.reviews.find((review) => review.gate === "audience" && (!latest || review.artifactId === latest.id));
  const [title, setTitle] = useState(latest?.title ?? "短片剧本");
  const [content, setContent] = useState(typeof latest?.content === "string" ? latest.content : JSON.stringify(latest?.content ?? {}, null, 2));
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState<"save" | "approved" | "rejected" | null>(null);
  const userCanReview = data.project.stage === "script_user_review";
  const canEdit = workflowStages.indexOf(data.project.stage) <= workflowStages.indexOf("script_user_review");
  useEffect(() => {
    setTitle(latest?.title ?? "短片剧本");
    setContent(typeof latest?.content === "string" ? latest.content : JSON.stringify(latest?.content ?? {}, null, 2));
  }, [latest?.id]);
  async function save() {
    setSubmitting("save"); setMessage("");
    try {
      let nextContent: unknown = content;
      if (isStructuredScreenplay(latest?.content)) {
        try { nextContent = JSON.parse(content); } catch { throw new Error("结构化剧本格式有误，请检查括号和引号后再保存。"); }
      }
      await api.addArtifact(data.project.id, { type: "script", title, content: nextContent, createdBy: "main-director" });
      setMessage("新剧本版本已保存，已重新进入内部审核。"); setEditing(false); await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setSubmitting(null); }
  }
  async function review(decision: "approved" | "rejected") {
    if (!userCanReview) return setMessage("当前阶段不是用户审剧本，不能重复提交审核。");
    if (decision === "rejected" && !feedback.trim()) return setMessage("退回修改前，请先填写具体审核意见。");
    if (decision === "approved" && !window.confirm(`确认通过剧本 V${latest?.version ?? 1}？\n\n将锁定：当前最新剧本内容\n下一阶段：资产设计\n\n锁定后只能查看，不能在后续阶段直接覆盖。`)) return;
    setSubmitting(decision); setMessage("");
    try {
      await api.review(data.project.id, { gate: "script_user", artifactId: latest?.id ?? null, decision, scores: {}, feedback: feedback.trim(), category: "用户剧本审核意见" });
      setMessage(decision === "approved" ? "剧本已通过，项目已进入资产设计阶段。" : "剧本已退回，审核意见已保存，Codex 可以读取并修改。");
      setFeedback(""); await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setSubmitting(null); }
  }
  return <>
    <PageHeader eyebrow="SCREENPLAY REVIEW" title="剧本审片室" description={canEdit ? "默认以阅读版展示完整剧本；只有需要改正文时，才切换到结构化编辑模式。" : "剧本已经锁定。你可以查看历史内容，但不能在后续制作阶段直接覆盖已锁定版本。"} actions={canEdit ? <div className="button-row"><button className="ghost" onClick={() => setEditing((value) => !value)}>{editing ? "返回阅读模式" : "编辑剧本原文"}</button>{editing && <button className="primary" disabled={submitting !== null} onClick={save}>{submitting === "save" ? "正在保存…" : "保存新版本"}</button>}</div> : <span className="status completed"><LockKeyhole size={13} />剧本已锁定</span>} />
    <div className="script-review-layout">
      <section className="panel screenplay-panel">{editing ? <div className="structured-editor"><div className="editor-warning"><ScrollText size={18} /><p><b>结构化编辑模式</b>这里用于精确修改剧本数据。一般审片请返回阅读模式，避免误删结构。</p></div><label>剧本标题<input value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>结构化剧本<textarea className="script-editor" value={content} onChange={(e) => setContent(e.target.value)} /></label></div> : <ScreenplayReader content={latest?.content} />}</section>
      <aside className="review-column">
        <section className="panel review-summary"><p className="eyebrow">REVIEW RESULTS</p><h2>内部审核结果</h2><p>评分来自总导演和观众 Agent 的真实审核记录，不再使用固定占位分数。</p><ScoreReport title="总导演审核" review={directorReview} /><ScoreReport title="观众审核" review={audienceReview} /></section>
        <section className="panel user-review-box"><p className="eyebrow">USER DECISION</p><div className="review-report-heading"><div><h2>你的最终决定</h2><small>{userCanReview ? "当前等待你的审核" : `当前阶段：${stageLabels[data.project.stage]}`}</small></div><span className={clsx("review-badge", userCanReview ? "waiting" : "approved")}>{userCanReview ? "待审核" : "已处理"}</span></div>{userCanReview ? <><label>审核意见<textarea value={feedback} disabled={submitting !== null} onChange={(e) => setFeedback(e.target.value)} placeholder="退回时必须写明：哪里不好、希望怎么改。通过时可选填。" /></label><div className="button-row"><button className="danger" disabled={submitting !== null} onClick={() => review("rejected")}>{submitting === "rejected" ? "正在退回…" : "退回修改"}</button><button className="primary" disabled={submitting !== null} onClick={() => review("approved")}>{submitting === "approved" ? "正在提交…" : "审核通过"}</button></div></> : <p className="notice">当前不在剧本审核阶段，审核操作已经收起。</p>}{message && <p className={clsx("notice", message.includes("请") || message.includes("不能") || message.includes("有误") ? "notice-error" : "")} aria-live="polite">{message}</p>}</section>
      </aside>
    </div>
  </>;
}

function AssetsPage({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const navigate = useNavigate();
  const [assetSearchParams] = useSearchParams();
  const [form, setForm] = useState({ type: "character", name: "", referenceCode: "", description: "", identityAnchor: "", prompt: "", negativePrompt: "" });
  const [message, setMessage] = useState("");
  const [completingReview, setCompletingReview] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => assetSearchParams.get("asset"));
  const selected = data.assets.find((asset) => asset.id === selectedId) ?? null;
  const [prompt, setPrompt] = useState("");
  const [settings, setSettings] = useState<{ hasApiKey: boolean; imageModel: string; imageResolution: string; videoModel: string; defaultProvider: "mock" | "apimart" } | null>(null);
  const [imageModel, setImageModel] = useState("gpt-image-2-official");
  const [resolution, setResolution] = useState("1k");
  const [aspectRatio, setAspectRatio] = useState("3:2");
  const [imageCount, setImageCount] = useState(1);
  const [lightboxUrl, setLightboxUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [creatingCodexRequest, setCreatingCodexRequest] = useState(false);
  const [cancellingCodexRequestId, setCancellingCodexRequestId] = useState("");
  const [uploadingReference, setUploadingReference] = useState(false);
  const [showProjectLibrary, setShowProjectLibrary] = useState(false);
  const [libraryScope, setLibraryScope] = useState<"all" | "asset" | "shot">("all");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [selectingReferenceMediaId, setSelectingReferenceMediaId] = useState("");
  const [lockingAssetMediaId, setLockingAssetMediaId] = useState("");
  const [assetFeedback, setAssetFeedback] = useState("");
  const [reviewingAsset, setReviewingAsset] = useState(false);
  const [showManualAssetForm, setShowManualAssetForm] = useState(false);
  const [assetQuery, setAssetQuery] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState<"all" | DashboardData["assets"][number]["type"]>("all");
  const [assetStatusFilter, setAssetStatusFilter] = useState<"all" | AssetUiStatus>("all");
  const assetModalRef = useRef<HTMLElement | null>(null);
  const assetReturnFocusRef = useRef<HTMLElement | null>(null);
  const modelOption = imageModelOption(imageModel);
  const assetGenerationReady = ["asset_design", "asset_user_review", "storyboard_design", "storyboard_user_review", "sample_image", "batch_generation"].includes(data.project.stage);
  const selectedJobs = selected ? data.jobs.filter((job) => job.kind === "image" && job.assetId === selected.id) : [];
  const selectedLatestJob = selectedJobs[0];
  const selectedPendingCodexRequests = selected ? data.codexImageRequests.filter((request) => request.assetId === selected.id && ["queued", "processing"].includes(request.status)) : [];
  const selectedActiveApiJob = selectedJobs.find((job) => ["apimart", "mock"].includes(job.provider) && ["draft", "submitted", "processing"].includes(job.status));
  const selectedActiveCodexRequest = selectedPendingCodexRequests[0];
  const selectedImageChannelLocked = Boolean(selectedActiveCodexRequest || selectedActiveApiJob);
  const projectImageLibrary = useMemo(() => {
    const imageJobs = new Map(data.jobs.filter((job) => job.kind === "image" && job.status === "completed").map((job) => [job.id, job]));
    const jobImageIndexes = new Map<string, number>();
    for (const job of imageJobs.values()) {
      data.mediaFiles
        .filter((media) => media.jobId === job.id && media.kind === "image")
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .forEach((media, index) => jobImageIndexes.set(media.id, index + 1));
    }
    return data.mediaFiles.flatMap((media) => {
      if (media.kind !== "image" || !media.jobId) return [];
      const job = imageJobs.get(media.jobId);
      if (!job) return [];
      const sourceAsset = job.assetId ? data.assets.find((asset) => asset.id === job.assetId) : undefined;
      const sourceShot = job.shotId ? data.shots.find((shot) => shot.id === job.shotId) : undefined;
      const sourceType = sourceAsset ? "asset" as const : sourceShot ? "shot" as const : "project" as const;
      const sourceName = sourceAsset ? `资产 · ${sourceAsset.name}` : sourceShot ? `镜头 ${sourceShot.shotNumber} · ${sourceShot.title}` : "项目生成图片";
      return [{ media, job, sourceType, sourceName, imageIndex: jobImageIndexes.get(media.id) ?? 1 }];
    });
  }, [data]);
  const selectedImageCandidates = selected ? projectImageLibrary.filter((item) => item.job.assetId === selected.id) : [];
  const selectedActiveJobsWithoutImages = selectedJobs.filter((job) =>
    isActiveAssetResultJob(job) && !selectedImageCandidates.some((item) => item.job.id === job.id)
  );
  const normalizedLibraryQuery = libraryQuery.trim().toLocaleLowerCase();
  const filteredProjectImages = projectImageLibrary.filter((item) => {
    const scopeMatches = libraryScope === "all" || item.sourceType === libraryScope;
    const queryMatches = !normalizedLibraryQuery || `${item.sourceName} ${item.job.model} ${item.job.provider}`.toLocaleLowerCase().includes(normalizedLibraryQuery);
    return scopeMatches && queryMatches;
  });
  const filteredAssets = useMemo(
    () => filterAndSortAssets(data.assets, { query: assetQuery, type: assetTypeFilter, status: assetStatusFilter }),
    [data.assets, assetQuery, assetTypeFilter, assetStatusFilter]
  );
  const nextPendingAsset = filterAndSortAssets(data.assets, {}).find((asset) => asset.id !== selected?.id && getAssetUiStatus(asset) !== "main_locked");
  useEffect(() => { void api.settings().then(setSettings); }, []);
  useEffect(() => {
    const requested = assetSearchParams.get("asset");
    if (requested && data.assets.some((asset) => asset.id === requested)) setSelectedId(requested);
  }, [assetSearchParams, data.assets]);
  useEffect(() => {
    setPrompt(cleanImagePrompt(selected?.prompt ?? ""));
    const nextModel = selected?.type === "character" ? "gpt-image-2-official" : settings?.imageModel ?? "gpt-image-2-official";
    const nextOption = imageModelOption(nextModel);
    setImageModel(nextModel);
    setResolution(nextOption.resolutions.includes("1k" as never) ? "1k" : nextOption.resolutions[0]);
    setAspectRatio(selected ? assetImageSize(selected) : "3:2");
    setImageCount(nextOption.counts[0]); setAssetFeedback(""); setMessage("");
  }, [selected?.id, settings?.imageModel, settings?.imageResolution]);
  useEffect(() => {
    setShowProjectLibrary(false);
    setLibraryScope("all");
    setLibraryQuery("");
  }, [selected?.id]);
  useEffect(() => {
    if (selectedId) {
      if (!assetReturnFocusRef.current) assetReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => assetModalRef.current?.querySelector<HTMLElement>("[data-modal-close]")?.focus());
      return;
    }
    assetReturnFocusRef.current?.focus();
    assetReturnFocusRef.current = null;
  }, [selectedId]);
  useEffect(() => {
    if (!selectedId && !lightboxUrl) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (lightboxUrl) setLightboxUrl("");
        else if (showProjectLibrary) setShowProjectLibrary(false);
        else setSelectedId(null);
        return;
      }
      if (event.key !== "Tab" || !selectedId || lightboxUrl || !assetModalRef.current) return;
      const focusable = Array.from(assetModalRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedId, lightboxUrl, showProjectLibrary]);
  async function save() { try { await api.saveAsset(data.project.id, { ...form, prompt: cleanImagePrompt(form.prompt) }); setForm({ ...form, name: "", referenceCode: "", description: "", identityAnchor: "", prompt: "", negativePrompt: "" }); await reload(); } catch (e) { setMessage((e as Error).message); } }
  function selectImageModel(model: string) {
    const option = imageModelOption(model);
    setImageModel(model);
    setResolution(option.resolutions[0]);
    setImageCount(option.counts[0]);
  }
  function confirmLockedAssetChange(action: string) {
    if (!selected || selected.status !== "approved" || !selected.approvedJobId) return true;
    const affected = data.shots.filter((shot) => shot.assetIds.includes(selected.id));
    const names = affected.slice(0, 8).map((shot) => `镜头 ${String(shot.shotNumber).padStart(2, "0")} · ${shot.title}`).join("\n");
    return window.confirm(`${action}“${selected.name}”的已锁定主图？\n\n将失效 ${affected.length} 个引用镜头${affected.length ? `：\n${names}${affected.length > 8 ? "\n……" : ""}` : "（当前没有镜头引用）"}\n\n失效镜头需要重新确认首帧和视频。`);
  }
  async function uploadReference(file: File | undefined) {
    if (!selected || !file || uploadingReference) return;
    if (!confirmLockedAssetChange("更换")) return;
    setUploadingReference(true); setMessage("");
    try {
      await api.uploadAssetReference(selected.id, file);
      setMessage("本地图片已设为生成参考图。它会用于后续一致性生成，但还需要从右侧生成结果中单独锁定资产主图。");
      await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setUploadingReference(false); }
  }
  async function selectProjectReference(mediaId: string) {
    if (!selected || selectingReferenceMediaId) return;
    if (!confirmLockedAssetChange("更换")) return;
    setSelectingReferenceMediaId(mediaId); setMessage("");
    try {
      await api.selectAssetReference(selected.id, mediaId);
      setMessage("已从项目图库选为生成参考图。后续生图会自动携带它；这一步不会把资产直接审核通过。");
      setShowProjectLibrary(false);
      await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setSelectingReferenceMediaId(""); }
  }
  async function lockAssetImage(jobId: string, mediaId: string) {
    if (!selected || lockingAssetMediaId) return;
    if (selected.referenceMediaId !== mediaId && !confirmLockedAssetChange("更换")) return;
    setLockingAssetMediaId(mediaId); setMessage("");
    try {
      await api.lockAssetImage(selected.id, jobId, mediaId);
      setMessage("这张图片已锁定为资产主图，并成为后续分镜引用的固定参考图。");
      await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setLockingAssetMediaId(""); }
  }
  async function generateAsset() {
    if (!selected || !settings || generating) return;
    setGenerating(true); setMessage("");
    try {
      if (!assetGenerationReady) throw new Error("当前阶段只能查看资产历史，不能再提交资产生图。");
      if (!data.project.dryRun && !settings.hasApiKey) throw new Error("请先到API设置中保存并测试APIMart API Key。");
      const provider = data.project.dryRun ? "mock" : "apimart";
      await api.createJob(data.project.id, {
        assetId: selected.id, kind: "image", provider, model: imageModel, prompt,
        params: imageModelParams(imageModel, resolution, aspectRatio, imageCount), batch: false
      });
      setMessage(data.project.dryRun
        ? `本地 Mock 图片任务已提交：${aspectRatio} · ${imageCount}张，不会产生API费用。`
        : `APIMart生图任务已提交：${imageModel} · ${resolution.toUpperCase()} · ${aspectRatio} · ${imageCount}张。`);
      await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setGenerating(false); }
  }
  async function createCodexRequest() {
    if (!selected || creatingCodexRequest) return;
    setCreatingCodexRequest(true); setMessage("");
    try {
      await api.createCodexImageRequest(selected.id, { prompt, aspectRatio, quality: "high", count: imageCount });
      setMessage("Codex 生图任务已创建。回到 Codex 对话说：处理工作台待生图任务。");
      await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setCreatingCodexRequest(false); }
  }
  async function cancelCodexRequest(requestId: string) {
    if (cancellingCodexRequestId) return;
    setCancellingCodexRequestId(requestId); setMessage("");
    try {
      await api.cancelCodexImageRequest(requestId);
      setMessage("Codex 生图任务已取消。现在可以重新选择 Codex 或 APIMart。若模型已经开始渲染，稍后返回的图片不会再导入工作台。");
      await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setCancellingCodexRequestId(""); }
  }
  async function rejectSelectedAsset() {
    if (!selected || reviewingAsset) return;
    if (!assetFeedback.trim()) { setMessage("退回资产前，请填写具体返工意见。"); return; }
    setReviewingAsset(true); setMessage("");
    try {
      await api.reviewAsset(selected.id, { decision: "rejected", feedback: assetFeedback });
      setMessage("该资产已退回，修改意见已记录。");
      setAssetFeedback("");
      await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setReviewingAsset(false); }
  }
  async function completeAssetReview() {
    if (completingReview) return;
    setCompletingReview(true); setMessage("");
    try {
      // The review may already have succeeded while the user is still viewing this page.
      if (["storyboard_design", "storyboard_user_review", "sample_image", "sample_video", "batch_generation", "final_review", "completed"].includes(data.project.stage)) {
        navigate(projectRoute(data.project.id, "storyboard"));
        return;
      }
      if (data.project.stage === "asset_design") {
        await api.addArtifact(data.project.id, { type: "asset_plan", title: "资产方案", content: { assetIds: data.assets.map((asset) => asset.id) }, createdBy: "asset-designer" });
      }
      await api.review(data.project.id, { gate: "asset_user", decision: "approved", scores: {}, feedback: "所有资产已逐项确认" });
      await reload();
      navigate(projectRoute(data.project.id, "storyboard"));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setCompletingReview(false);
    }
  }
  function assetCard(asset: DashboardData["assets"][number]) {
    const uiStatus = getAssetUiStatus(asset);
    const statusClass = uiStatus === "main_locked" ? "completed" : uiStatus === "needs_review" ? "failed" : uiStatus === "reference_only" ? "processing" : "draft";
    const assetCandidates = projectImageLibrary.filter((item) => item.job.assetId === asset.id);
    const latestCandidate = assetCandidates[0];
    const coverUrl = asset.referenceMediaId ? `/api/assets/${asset.id}/reference` : latestCandidate ? `/api/media/${latestCandidate.media.id}` : "";
    return <article className="asset-card asset-card-clickable" key={asset.id} role="button" tabIndex={0} onClick={() => setSelectedId(asset.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedId(asset.id); }}>
      <div className="asset-cover">{coverUrl ? <img src={coverUrl} alt={`${asset.name}生成结果`} /> : <Users />}<span>{asset.type}</span><span className={clsx("status", statusClass)}>{assetUiStatusLabels[uiStatus]}</span></div>
      <div><div className="card-meta"><span>V{asset.version}</span><span>{asset.referenceCode || asset.id}</span></div><h3>{asset.name}</h3><p>{asset.description}</p><button className="asset-action-box" onClick={(e) => { e.stopPropagation(); setSelectedId(asset.id); }}><span>查看参考图、提示词和生成结果</span><b>{assetCandidates.length ? `${assetCandidates.length} 张候选图` : "点击生图"}</b></button></div>
    </article>;
  }
  const assetGroups = [
    { type: "character", title: "人物资产", description: "角色身份、妆造、服装和表情基准。" },
    { type: "scene", title: "场景资产", description: "固定空间布局、环境材质和光线关系。" },
    { type: "prop", title: "道具资产", description: "剧情中需要保持外观一致的物件。" },
    { type: "style", title: "整体风格", description: "全片统一使用的影像质感和美术方向。" }
  ] as const;
  const visibleAssetGroups = assetGroups.filter((group) => assetTypeFilter === "all" || group.type === assetTypeFilter);
  const approvedAssetCount = data.assets.filter((asset) => asset.status === "approved" && asset.approvedJobId).length;
  const allAssetsApproved = data.assets.length > 0 && approvedAssetCount === data.assets.length;
  return <><PageHeader eyebrow="ASSET BIBLE" title="资产中心" description="参考图可以从本地上传，也可以直接从当前项目已经生成的图片中选取；每个资产必须明确锁定一张主图。" />
    {message && !selected && <p className="notice notice-error wide" aria-live="polite">{message}</p>}
    <section className="panel asset-filter-bar" aria-label="资产筛选">
      <label>搜索资产<input type="search" value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder="输入资产名称、编号或说明" /></label>
      <label>资产分类<select value={assetTypeFilter} onChange={(event) => setAssetTypeFilter(event.target.value as typeof assetTypeFilter)}><option value="all">全部分类</option><option value="character">人物</option><option value="scene">场景</option><option value="prop">道具</option><option value="style">风格</option></select></label>
      <label>确认状态<select value={assetStatusFilter} onChange={(event) => setAssetStatusFilter(event.target.value as typeof assetStatusFilter)}><option value="all">全部状态</option><option value="needs_review">需复核</option><option value="pending">待生成</option><option value="reference_only">仅参考图</option><option value="main_locked">主图已锁定</option></select></label>
      <div className="asset-filter-summary"><strong>{filteredAssets.length}</strong><span>项符合条件</span><small>审核进度仍按全部 {data.assets.length} 项计算</small></div>
    </section>
    <div className="asset-category-list">{visibleAssetGroups.map((group) => { const assets = filteredAssets.filter((asset) => asset.type === group.type); return <section className="asset-category" key={group.type}><header><div><h2>{group.title}</h2><p>{group.description}</p></div><span>{assets.length} 项</span></header><div className="asset-grid">{assets.map(assetCard)}{!assets.length && <Empty text={`当前筛选下没有${group.title}。`} />}</div></section>; })}</div>
    <details className="manual-asset-details" open={showManualAssetForm} onToggle={(event) => setShowManualAssetForm(event.currentTarget.open)}><summary><span>手动添加资产</span><small>工作台默认由 Codex 驱动；只有需要人工补录时才展开</small></summary><section className="panel form-card asset-create-panel"><h2>添加资产</h2><label>资产分类<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="character">人物</option><option value="scene">场景</option><option value="prop">道具</option><option value="style">整体风格</option></select></label><label>资产名称<input placeholder="例如：猫掌柜角色" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>资产引用编号<input placeholder="例如 STYLE_HK_001（不发送给模型）" value={form.referenceCode} onChange={(e) => setForm({ ...form, referenceCode: e.target.value })} /></label><label>外观和用途说明<textarea placeholder="说明这个资产长什么样、在片中做什么" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><label>固定身份锚点<textarea placeholder="例如脸型、发型、服装、体型" value={form.identityAnchor} onChange={(e) => setForm({ ...form, identityAnchor: e.target.value })} /></label><label>生图提示词<textarea placeholder="完整资产生图提示词" value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} /></label><button className="primary" onClick={save}>保存资产</button></section></details>
    {selected && <div className="asset-modal-backdrop" onMouseDown={() => setSelectedId(null)}><section ref={assetModalRef} className="asset-modal" role="dialog" aria-modal="true" aria-labelledby="asset-modal-title" onMouseDown={(e) => e.stopPropagation()}>
      <header><div><p className="eyebrow">ASSET IMAGE GENERATION</p><h2 id="asset-modal-title" title={selected.name}>{selected.name}</h2><span>{selected.type.toUpperCase()} · V{selected.version} · {assetImageSize(selected)}</span></div><button className="icon-button" data-modal-close onClick={() => setSelectedId(null)} aria-label="关闭资产弹窗"><X /></button></header>
      <div className="asset-modal-grid">
        <div className="asset-generation-panel">
          <div className="asset-reference-box">
            <span>工作台资产引用</span><strong title={selected.referenceCode || selected.id}>{selected.referenceCode || selected.id}</strong>
            <small>仅用于版本追踪和镜头引用，不会写入生图提示词，也不会发送给模型。</small>
          </div>
          <div className="asset-anchor-box"><span>固定身份锚点</span><p>{selected.identityAnchor || "尚未设置身份锚点"}</p></div>
          <div className="reference-lock-section">
            <div className="reference-lock-copy"><strong>生成参考图</strong><p>用于下一次生图保持一致，不代表资产已经审核通过。可以本地上传，也可以直接从当前项目图库选择。</p></div>
            {selected.referenceMediaId ? <button type="button" className="locked-reference-preview" onClick={() => setLightboxUrl(`/api/assets/${selected.id}/reference`)}><img src={`/api/assets/${selected.id}/reference`} alt="当前资产生成参考图" /><span>{selected.status === "approved" ? "当前资产主图" : "当前生成参考图"} · 点击放大</span></button> : <div className="reference-empty">当前没有生成参考图</div>}
            <div className="reference-source-actions">
              <label className="reference-upload-button"><input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadingReference} onChange={(event) => { void uploadReference(event.target.files?.[0]); event.currentTarget.value = ""; }} /><Upload size={15} /><span>{uploadingReference ? "正在上传…" : "本地上传"}</span></label>
              <button type="button" className={clsx("reference-library-button", showProjectLibrary && "active")} onClick={() => setShowProjectLibrary((value) => !value)} aria-expanded={showProjectLibrary}><Images size={15} />项目图库</button>
            </div>
          </div>
          {showProjectLibrary && <section className="project-image-picker" aria-label="当前项目已生成图片">
            <header><div><strong>从项目图库选择</strong><span>这里只显示当前项目已经生成完成并保存到本地的图片。</span></div><button type="button" className="icon-button compact" onClick={() => setShowProjectLibrary(false)} aria-label="收起项目图库"><X size={16} /></button></header>
            <div className="project-image-toolbar">
              <input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="搜索资产名、镜头名或模型" aria-label="搜索项目图片" />
              <div className="library-scope-tabs" role="group" aria-label="项目图片范围">{(["all", "asset", "shot"] as const).map((scope) => <button type="button" key={scope} className={libraryScope === scope ? "active" : ""} onClick={() => setLibraryScope(scope)}>{scope === "all" ? "全部" : scope === "asset" ? "资产图" : "分镜图"}</button>)}</div>
            </div>
            <div className="project-image-grid">{filteredProjectImages.map((item) => { const isCurrentReference = selected.referenceMediaId === item.media.id; return <article className={clsx("project-image-option", isCurrentReference && "selected")} key={item.media.id}>
              <button type="button" className="project-image-preview" onClick={() => setLightboxUrl(`/api/media/${item.media.id}`)}><img loading="lazy" src={`/api/media/${item.media.id}`} alt={`${item.sourceName}生成图片`} /><span>{item.sourceType === "asset" ? "资产" : item.sourceType === "shot" ? "分镜" : "项目"}</span></button>
              <div><strong title={item.sourceName}>{item.sourceName}</strong><small>{item.job.provider === "codex" ? "Codex · gpt-image-2" : item.job.model} · 第 {item.imageIndex} 张</small><button type="button" className={isCurrentReference ? "ghost" : "primary"} disabled={isCurrentReference || Boolean(selectingReferenceMediaId)} onClick={() => selectProjectReference(item.media.id)}>{isCurrentReference ? <><Check size={14} />当前参考图</> : selectingReferenceMediaId === item.media.id ? "正在选取…" : "选作生成参考图"}</button></div>
            </article>; })}{!filteredProjectImages.length && <Empty text={projectImageLibrary.length ? "没有符合搜索条件的图片。" : "当前项目还没有已生成图片，可以先生图或使用本地上传。"} />}</div>
          </section>}
          <label>生图提示词<textarea className="asset-prompt-editor" value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
          <div className="asset-parameter-grid">
            <label><span>生图模型</span><select value={imageModel} onChange={(e) => selectImageModel(e.target.value)}>{imageModelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
            <label><span>{imageModel === "midjourney" ? "生成速度" : "生图质量"}</span><select value={resolution} onChange={(e) => setResolution(e.target.value)}>{modelOption.resolutions.map((value) => <option key={value} value={value}>{imageResolutionLabel(imageModel, value)}</option>)}</select></label>
            <label><span>画幅比例</span><select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}><option value="1:1">1:1 方形</option><option value="3:2">3:2 横向设定图</option><option value="2:3">2:3 竖向角色图</option><option value="4:3">4:3 横向</option><option value="3:4">3:4 竖向</option><option value="16:9">16:9 宽屏场景</option><option value="9:16">9:16 竖屏镜头</option></select></label>
            <label><span>生成数量</span><select value={imageCount} onChange={(e) => setImageCount(Number(e.target.value))}>{modelOption.counts.map((value) => <option key={value} value={value}>{imageModel === "midjourney" ? "1组四宫格" : `${value}张`}</option>)}</select></label>
          </div>
          <div className="parameter-note"><span>{data.project.dryRun ? "空跑测试只创建本地 Mock 占位图，不调用任何真实生图服务。" : "APIMart 可自动生成；Codex 通道会创建待处理任务，由当前对话使用内置 gpt-image-2 完成。"}</span><b>{selected.referenceMediaId ? "生成时会自动携带参考图" : "当前为文生图"}</b></div>
          <div className="generation-channel-actions">{!data.project.dryRun && <button className="codex-generate-button" disabled={!assetGenerationReady || creatingCodexRequest || selectedImageChannelLocked} onClick={createCodexRequest}><Sparkles size={18} />{creatingCodexRequest ? "正在创建任务…" : "使用 Codex 额度"}</button>}<button className="primary asset-generate-button" disabled={!assetGenerationReady || (!data.project.dryRun && !settings?.hasApiKey) || generating || selectedImageChannelLocked} onClick={generateAsset}><Sparkles size={18} />{generating ? "正在提交…" : !assetGenerationReady ? "当前阶段仅可查看" : data.project.dryRun ? "本地 Mock 空跑 · 零费用" : `APIMart 付费生图 · ${imageResolutionLabel(imageModel, resolution)}`}</button></div>
          {selectedImageChannelLocked && <div className="image-channel-lock"><div><Status value={selectedActiveCodexRequest?.status ?? selectedActiveApiJob?.status ?? "processing"} /><span>{selectedActiveCodexRequest ? "已选择 Codex 通道，生成通常需要几分钟；任务结束前 APIMart 已锁定。" : "APIMart 付费任务已提交；完成或失败前 Codex 通道已锁定。"}</span></div>{selectedActiveCodexRequest && <button className="danger" disabled={cancellingCodexRequestId === selectedActiveCodexRequest.id} onClick={() => cancelCodexRequest(selectedActiveCodexRequest.id)}>{cancellingCodexRequestId === selectedActiveCodexRequest.id ? "正在取消…" : "取消 Codex 任务并解锁"}</button>}</div>}
          {settings && !settings.hasApiKey && !data.project.dryRun && <p className="notice notice-error">APIMart Key 未配置，但仍可使用 Codex 额度通道。</p>}
          {message && <p className="notice" aria-live="polite">{message}</p>}
        </div>
        <aside className="asset-results-panel">
          <div className="asset-results-heading"><div><h3>该资产的生成结果</h3><span>每张图片都可以单独放大、比较和锁定</span></div><b>{selectedImageCandidates.length} 张可选</b></div>
          <div className="asset-results-scroll" tabIndex={0} aria-label={`${selected.name}可用生成结果`}>
            {selectedPendingCodexRequests.map((request) => <article className="codex-request-card result-status-card" key={request.id}><Status value={request.status} /><strong>Codex · gpt-image-2</strong><p>{request.prompt.slice(0, 90)}</p><small>{request.aspectRatio} · {request.quality === "high" ? "高质量" : "标准质量"} · {request.count}张</small><code>{request.id}</code></article>)}
            {selectedActiveJobsWithoutImages.map((job) => <article className="codex-request-card result-status-card" key={job.id}><Status value={job.status} /><strong>{job.provider === "codex" ? "Codex · gpt-image-2" : job.model}</strong><p>{job.prompt.slice(0, 90)}</p><small>生成进度 {job.progress}%</small></article>)}
            {selectedImageCandidates.map((item) => { const isMainImage = selected.status === "approved" && selected.approvedJobId === item.job.id && selected.referenceMediaId === item.media.id; const isReference = selected.referenceMediaId === item.media.id; return <article className={clsx("asset-image-candidate", isMainImage && "locked", isReference && !isMainImage && "reference-selected")} key={item.media.id}>
              <button type="button" className="asset-candidate-preview" onClick={() => setLightboxUrl(`/api/media/${item.media.id}`)}><img loading="lazy" src={`/api/media/${item.media.id}`} alt={`${selected.name}候选图片${item.imageIndex}`} /><span>第 {item.imageIndex} 张 · 点击放大</span>{isMainImage && <b><LockKeyhole size={13} />资产主图</b>}{isReference && !isMainImage && <b className="reference-badge">生成参考图</b>}</button>
              <div className="asset-candidate-body"><div className="media-status-row"><Status value={item.job.status} /><small>{new Date(item.media.createdAt).toLocaleString()}</small></div><strong>{item.job.provider === "codex" ? "Codex · gpt-image-2" : item.job.model}</strong><p>{item.job.prompt.slice(0, 72)}</p><button type="button" className={isMainImage ? "ghost" : "primary"} disabled={isMainImage || Boolean(lockingAssetMediaId)} onClick={() => lockAssetImage(item.job.id, item.media.id)}>{isMainImage ? <><Check size={15} />主图已锁定</> : lockingAssetMediaId === item.media.id ? "正在锁定…" : <><LockKeyhole size={15} />锁定为资产主图</>}</button></div>
            </article>; })}
            {!selectedImageCandidates.length && !selectedActiveJobsWithoutImages.length && !selectedPendingCodexRequests.length && <Empty text="还没有可用图片。确认提示词后可直接生图；失败记录请到任务中心查看。" />}
          </div>
          <section className="asset-item-review"><div><strong>资产确认</strong><span>{selected.status === "approved" ? "主图已锁定，资产已完成" : selected.status === "stale" ? "需要重新选择并锁定主图" : "等待选择资产主图"}</span></div>{selected.status === "approved" ? <p className="asset-lock-success"><LockKeyhole size={14} />当前锁定的是上方带“资产主图”标记的图片，后续分镜会引用它。</p> : selectedImageCandidates.length > 0 ? <p className="asset-review-warning">请比较上方候选图，并直接点击对应图片下方的“锁定为资产主图”。</p> : <p className="asset-review-warning">生成完成后，这里会把同一次任务返回的多张图片逐张列出。</p>}{selectedImageChannelLocked && <p className="asset-review-warning">新任务仍在生成；你可以锁定已有候选图，新任务完成后不会自动替换它。</p>}<label>返工意见<textarea value={assetFeedback} onChange={(e) => setAssetFeedback(e.target.value)} placeholder="例如人物、构图、服装、材质或文字哪里需要修改" /></label><div className="button-row"><button className="danger" disabled={reviewingAsset} onClick={rejectSelectedAsset}>{reviewingAsset ? "正在退回…" : "退回修改"}</button>{selected.status === "approved" && nextPendingAsset && <button className="ghost" onClick={() => setSelectedId(nextPendingAsset.id)}>下一个待确认资产 · {nextPendingAsset.name}</button>}</div></section>
        </aside></div>
    </section></div>}{lightboxUrl && <div className="image-lightbox" onClick={() => setLightboxUrl("")}><button className="icon-button" aria-label="关闭大图"><X /></button><img src={lightboxUrl} alt="参考图大图预览" /></div>}
    {data.project.stage === "asset_user_review" && <section className="approval-bar asset-review-progress"><div><strong>资产审核进度：{approvedAssetCount}/{data.assets.length}</strong><span>{allAssetsApproved ? "所有资产均已逐项确认，可以进入分镜。" : `还需确认 ${data.assets.length - approvedAssetCount} 个资产。请打开资产逐项审核。`}</span></div><div className="asset-progress-track"><i style={{ width: `${data.assets.length ? approvedAssetCount / data.assets.length * 100 : 0}%` }} /></div><button className="primary" disabled={!allAssetsApproved || completingReview} onClick={completeAssetReview}>{completingReview ? "正在进入分镜…" : "完成资产审核，进入分镜"}</button></section>}</>;
}

function StoryboardPage({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const navigate = useNavigate();
  const shotWriteReady = ["storyboard_design", "storyboard_user_review", "sample_image", "sample_video", "batch_generation"].includes(data.project.stage);
  const shotImageGenerationReady = ["storyboard_design", "storyboard_user_review", "sample_image", "batch_generation"].includes(data.project.stage);
  const nextNumber = data.shots.length ? Math.max(...data.shots.map((s) => s.shotNumber)) + 1 : 1;
  const emptyShotForm = { id: undefined as string | undefined, shotNumber: nextNumber, title: "", duration: 5, narrativePurpose: "", composition: "", camera: "", action: "", dialogue: "", imagePrompt: "", videoPrompt: "", assetIds: [] as string[], videoReferenceMediaIds: [] as string[], sceneId: "scene-01", parentShotId: null as string | null, sequenceRelation: (nextNumber === 1 ? "sequence_first_clip" : "intentional_next_shot") as DashboardData["shots"][number]["sequenceRelation"], feltIntent: "", plannedStartState: "", plannedEndState: "", alreadyHappened: "", reservedForLater: "", continuityLocks: "", allowedChanges: "", audioMode: "generated" as DashboardData["shots"][number]["audioMode"], audioAssetIds: [] as string[], speakerMap: "", audioDirection: "", lipSyncNotes: "" };
  const [form, setForm] = useState(emptyShotForm);
  const [message, setMessage] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [settings, setSettings] = useState<{ hasApiKey: boolean; imageModel: string; imageResolution: string; videoModel: string; defaultProvider: "mock" | "apimart" } | null>(null);
  const [generatingShotId, setGeneratingShotId] = useState("");
  const [cancellingCodexRequestId, setCancellingCodexRequestId] = useState("");
  const [lockingImageId, setLockingImageId] = useState("");
  const [videoReviewingId, setVideoReviewingId] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState("");
  const [shotParams, setShotParams] = useState<Record<string, { model: string; resolution: string; aspectRatio: string; count: number }>>({});
  const [videoParams, setVideoParams] = useState<Record<string, { model: string; resolution: VideoResolution; generateAudio: boolean }>>({});
  const [videoFeedback, setVideoFeedback] = useState<Record<string, string>>({});
  const [promptDrafts, setPromptDrafts] = useState<Record<string, { image: string; video: string }>>({});
  const [observedStates, setObservedStates] = useState<Record<string, string>>({});
  const [observedAudioStates, setObservedAudioStates] = useState<Record<string, string>>({});
  const [audioForm, setAudioForm] = useState({ type: "character_voice", name: "", characterAssetId: "", remoteUrl: "", duration: "", rightsNote: "", description: "" });
  const [audioFile, setAudioFile] = useState<File | undefined>();
  const [creatingAudio, setCreatingAudio] = useState(false);
  const [audioGeneration, setAudioGeneration] = useState({ type: "dialogue_line", name: "", characterAssetId: "", textPrompt: "", speaker: "", referenceAudioUrls: "", format: "wav", sampleRate: 24000, enableSubtitle: true, speechRate: 0, pitchRate: 0, loudnessRate: 0, rightsNote: "本人拥有或已获授权使用该声音", description: "" });
  const [generatingAudioAsset, setGeneratingAudioAsset] = useState(false);
  const [buildingPreview, setBuildingPreview] = useState(false);
  useEffect(() => { void api.settings().then(setSettings); }, []);
  async function save() { try { await api.saveShot(data.project.id, form); setForm({ ...emptyShotForm, shotNumber: form.id ? nextNumber : form.shotNumber + 1, sequenceRelation: form.id || form.shotNumber > 1 ? "intentional_next_shot" : "sequence_first_clip" }); setMessage(form.id ? "镜头契约已更新。" : "镜头已添加。"); await reload(); } catch (e) { setMessage((e as Error).message); } }
  function editShot(shot: DashboardData["shots"][number]) { setForm({ id: shot.id, shotNumber: shot.shotNumber, title: shot.title, duration: shot.duration, narrativePurpose: shot.narrativePurpose, composition: shot.composition, camera: shot.camera, action: shot.action, dialogue: shot.dialogue, imagePrompt: shot.imagePrompt, videoPrompt: shot.videoPrompt, assetIds: shot.assetIds, videoReferenceMediaIds: shot.videoReferenceMediaIds, sceneId: shot.sceneId, parentShotId: shot.parentShotId, sequenceRelation: shot.sequenceRelation, feltIntent: shot.feltIntent, plannedStartState: shot.plannedStartState, plannedEndState: shot.plannedEndState, alreadyHappened: shot.alreadyHappened, reservedForLater: shot.reservedForLater, continuityLocks: shot.continuityLocks, allowedChanges: shot.allowedChanges, audioMode: shot.audioMode, audioAssetIds: shot.audioAssetIds, speakerMap: shot.speakerMap, audioDirection: shot.audioDirection, lipSyncNotes: shot.lipSyncNotes }); document.querySelector(".shot-form")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  async function createAudioAsset() {
    if (creatingAudio) return; setCreatingAudio(true); setMessage("");
    try { await api.createAudioAsset(data.project.id, { ...audioForm, duration: audioForm.duration || "0" }, audioFile); setAudioForm({ type: "character_voice", name: "", characterAssetId: "", remoteUrl: "", duration: "", rightsNote: "", description: "" }); setAudioFile(undefined); setMessage("声音资产已保存。只有填写 HTTPS 远程地址的声音资产才能提交给 APIMart；本地文件用于试听和存档。"); await reload(); }
    catch (e) { setMessage((e as Error).message); } finally { setCreatingAudio(false); }
  }
  async function generateAudioAsset() {
    if (generatingAudioAsset) return;
    if (!audioGeneration.name.trim() || !audioGeneration.textPrompt.trim()) { setMessage("请填写声音资产名称和音频提示词/台词。"); return; }
    setGeneratingAudioAsset(true); setMessage("");
    try {
      await api.generateAudioAsset(data.project.id, { ...audioGeneration, referenceAudioUrls: audioGeneration.referenceAudioUrls.split(/[,\n]/).map((item) => item.trim()).filter(Boolean) });
      setMessage("火山豆包音频任务已提交。生成完成后会自动下载到本机并进入声音资产库；请在任务中心查看状态。等待期间不要重复点击。");
      setAudioGeneration((current) => ({ ...current, name: "", textPrompt: "", referenceAudioUrls: "" }));
      await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setGeneratingAudioAsset(false); }
  }
  function compiledVideoPrompt(shot: DashboardData["shots"][number]) {
    const imageRefs = shot.assetIds.map((assetId, index) => ({ asset: data.assets.find((item) => item.id === assetId), tag: `@Image${index + 1}` })).filter((item) => item.asset);
    const imageBlock = imageRefs.map(({ asset, tag }) => `${tag} ${asset!.name}，保持该参考图的身份、服装和材质一致`).join("；");
    const refs = shot.audioAssetIds.map((audioId, index) => ({ asset: data.audioAssets.find((item) => item.id === audioId), tag: `@Audio${index + 1}` })).filter((item) => item.asset);
    const referenceMap = refs.map(({ asset, tag }) => `${tag} ${asset!.type === "dialogue_line" ? "提供准确台词、声音和口型时序" : asset!.type === "character_voice" ? "只控制该角色音色与说话质感" : asset!.type === "music" ? "控制音乐节拍、段落和表演时钟" : asset!.type === "ambience" ? "控制环境底噪" : "控制关键音效时点"}`).join("；");
    const videoRefs = shot.videoReferenceMediaIds.map((mediaId, index) => ({ media: data.mediaFiles.find((item) => item.id === mediaId), tag: `@Video${index + 1}` })).filter((item) => item.media);
    const videoBlock = videoRefs.map(({ tag }) => `${tag} 作为动作和镜头连续性参考`).join("；");
    const audioBlock = [imageBlock && `图片参考：${imageBlock}。`, videoBlock && `视频参考：${videoBlock}。`, referenceMap && `音频参考：${referenceMap}。`, shot.speakerMap && `说话人分配：${shot.speakerMap}。`, shot.audioDirection && `声音设计：${shot.audioDirection}。`, shot.lipSyncNotes && `口型约束：${shot.lipSyncNotes}。`].filter(Boolean).join("");
    return `${shot.videoPrompt}${audioBlock}`;
  }
  async function approve(decision: "approved" | "rejected") { try {
    if (data.project.stage !== "storyboard_user_review" || data.shots.length === 0) throw new Error("只有进入完整分镜审核且至少有一个镜头时，才能提交审核。");
    if (decision === "rejected" && !reviewFeedback.trim()) throw new Error("退回完整分镜前，请填写具体修改意见。");
    if (decision === "approved" && !window.confirm(`确认通过完整分镜？\n\n当前版本：${data.shots.length} 个镜头，共 ${data.shots.reduce((sum, shot) => sum + shot.duration, 0)} 秒\n将锁定：镜头顺序、镜头契约与资产引用\n下一阶段：代表性首帧样片`)) return;
    await api.review(data.project.id, { gate: "storyboard_user", decision, scores: {}, feedback: reviewFeedback }); await reload();
  } catch (e) { setMessage((e as Error).message); } }
  async function buildFinalPreview() {
    if (buildingPreview) return;
    setBuildingPreview(true); setMessage("");
    try {
      await api.preview(data.project.id);
      await reload();
      navigate(projectRoute(data.project.id, "preview"));
    } catch (e) { setMessage((e as Error).message); } finally { setBuildingPreview(false); }
  }
  function paramsFor(shotId: string) {
    const saved = shotParams[shotId];
    const model = saved?.model ?? settings?.imageModel ?? imageModelOptions[0].id;
    const option = imageModelOption(model);
    const resolution = option.resolutions.some((value) => value === saved?.resolution)
      ? saved!.resolution
      : option.resolutions.some((value) => value === settings?.imageResolution) ? settings!.imageResolution : option.resolutions[0];
    const count = option.counts.some((value) => value === saved?.count) ? saved!.count : option.counts[0];
    return { model, resolution, aspectRatio: saved?.aspectRatio ?? data.project.aspectRatio, count };
  }
  function updateShotParams(shotId: string, patch: Partial<ReturnType<typeof paramsFor>>) {
    setShotParams((current) => ({ ...current, [shotId]: { ...paramsFor(shotId), ...patch } }));
  }
  async function saveShotPrompt(shot: DashboardData["shots"][number], kind: "image" | "video") {
    const draft = promptDrafts[shot.id];
    const imagePrompt = draft?.image ?? shot.imagePrompt;
    const videoPrompt = draft?.video ?? shot.videoPrompt;
    try {
      await api.saveShot(data.project.id, { ...shot, imagePrompt, videoPrompt, videoReferenceMediaIds: shot.videoReferenceMediaIds });
      setMessage(`${kind === "image" ? "首帧生图" : "视频生成"}提示词已保存。`);
      await reload();
    } catch (e) { setMessage((e as Error).message); }
  }
  async function updateShotVideoReferences(shot: DashboardData["shots"][number], mediaId: string) {
    const next = shot.videoReferenceMediaIds.includes(mediaId) ? shot.videoReferenceMediaIds.filter((id) => id !== mediaId) : [...shot.videoReferenceMediaIds, mediaId];
    if (next.length > 3) { setMessage("每个镜头最多绑定3段视频参考。"); return; }
    try { await api.saveShot(data.project.id, { ...shot, videoReferenceMediaIds: next }); await reload(); } catch (e) { setMessage((e as Error).message); }
  }
  async function generateShotImage(shot: DashboardData["shots"][number], channel: "codex" | "apimart") {
    if (generatingShotId) return;
    setGeneratingShotId(shot.id); setMessage("");
    try {
      if (!shotImageGenerationReady) throw new Error("当前阶段只能查看分镜首帧历史，不能再提交生图。");
      const params = paramsFor(shot.id);
      const prompt = promptDrafts[shot.id]?.image ?? shot.imagePrompt;
      if (channel === "codex") {
        if (data.project.dryRun) throw new Error("空跑测试项目禁止创建Codex真实生图任务。");
        await api.createCodexShotImageRequest(shot.id, { prompt, aspectRatio: params.aspectRatio, quality: params.resolution === "1k" ? "standard" : "high", count: params.count });
      }
      else {
        if (!data.project.dryRun && !settings?.hasApiKey) throw new Error("请先在 API 设置中保存有效的 APIMart Key。");
        await api.createJob(data.project.id, { shotId: shot.id, kind: "image", provider: data.project.dryRun ? "mock" : "apimart", model: params.model, prompt,
          params: imageModelParams(params.model, params.resolution, params.aspectRatio, params.count), batch: false });
      }
      setMessage(channel === "codex"
        ? `镜头 ${shot.shotNumber} 已加入 Codex 待生图任务。回到对话说：处理工作台待生图任务。`
        : data.project.dryRun ? `镜头 ${shot.shotNumber} 已提交本地 Mock 首帧，不会产生API费用。` : `镜头 ${shot.shotNumber} 已提交 APIMart 生图。`);
      await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setGeneratingShotId(""); }
  }
  async function cancelShotCodexRequest(requestId: string) {
    if (cancellingCodexRequestId) return;
    setCancellingCodexRequestId(requestId); setMessage("");
    try {
      await api.cancelCodexImageRequest(requestId);
      setMessage("Codex 生图任务已取消，当前镜头的两种生图方式已经重新解锁。若模型已经开始渲染，稍后返回的图片不会导入工作台。");
      await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setCancellingCodexRequestId(""); }
  }
  async function lockShotImage(shotId: string, jobId: string, mediaId: string) {
    if (lockingImageId) return; setLockingImageId(mediaId); setMessage("");
    try { await api.lockShotImage(shotId, jobId, mediaId); setMessage("首帧已锁定，Seedance 视频生成会自动携带这张图。"); await reload(); }
    catch (e) { setMessage((e as Error).message); } finally { setLockingImageId(""); }
  }
  async function generateShotVideo(shot: DashboardData["shots"][number]) {
    if (!settings || generatingShotId) return; setGeneratingShotId(shot.id); setMessage("");
    const defaultVideoModel = settings.videoModel && videoModelOptions.some((option) => option.id === settings.videoModel) ? settings.videoModel : videoModelOptions[0].id;
    const defaultVideoOption = videoModelOption(defaultVideoModel);
    const params = videoParams[shot.id] ?? { model: defaultVideoModel, resolution: (defaultVideoOption.resolutions.includes("720p") ? "720p" : defaultVideoOption.resolutions[0]) as VideoResolution, generateAudio: true };
    try {
      if (!data.project.dryRun && !settings.hasApiKey) throw new Error("请先在 API 设置中保存有效的 APIMart Key。");
      const promptShot = { ...shot, videoPrompt: promptDrafts[shot.id]?.video ?? shot.videoPrompt };
      await api.createJob(data.project.id, { shotId: shot.id, kind: "video", provider: data.project.dryRun ? "mock" : "apimart", model: params.model, prompt: compiledVideoPrompt(promptShot),
        params: { size: data.project.aspectRatio, resolution: params.resolution, duration: Math.max(4, Math.min(15, shot.duration)), generate_audio: params.generateAudio, return_last_frame: true }, batch: data.project.stage === "batch_generation" });
      setMessage(data.project.dryRun
        ? `镜头 ${shot.shotNumber} 已提交本地 Mock 视频，不会调用Seedance或产生API费用。`
        : `镜头 ${shot.shotNumber} 已提交 Seedance 视频生成，锁定首帧和连续性状态会自动携带。`); await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setGeneratingShotId(""); }
  }
  async function reviewShotVideo(shot: DashboardData["shots"][number], jobId: string, decision: "approved" | "rejected") {
    if (videoReviewingId) return; setVideoReviewingId(jobId); setMessage("");
    try { await api.reviewShotVideo(shot.id, { jobId, decision, feedback: videoFeedback[shot.id] ?? "", observedEndState: observedStates[shot.id] ?? shot.plannedEndState, observedAudioState: observedAudioStates[shot.id] ?? shot.observedAudioState }); setMessage(decision === "approved" ? `镜头 ${shot.shotNumber} 视频已通过，真实画面、声音状态和尾帧已记录。` : `镜头 ${shot.shotNumber} 已退回，意见已写入修改任务。`); await reload(); }
    catch (e) { setMessage((e as Error).message); } finally { setVideoReviewingId(""); }
  }
  return <>
    <PageHeader eyebrow="SHOT PRODUCTION" title="分镜生产" description={`当前 ${data.shots.length} 个镜头，共 ${data.shots.reduce((sum, s) => sum + s.duration, 0)} 秒；每个镜头都拆分为首帧生图和视频生成。`} />
    {message && <p className="notice wide" aria-live="polite">{message}</p>}
    <div className="shot-list">{data.shots.map((shot) => {
      const linkedAssets = data.assets.filter((asset) => shot.assetIds.includes(asset.id));
      const jobs = data.jobs.filter((job) => job.kind === "image" && job.shotId === shot.id);
      const videoJobs = data.jobs.filter((job) => job.kind === "video" && job.shotId === shot.id);
      const requests = data.codexImageRequests.filter((request) => request.shotId === shot.id && ["queued", "processing"].includes(request.status));
      const activeApiImageJob = jobs.find((job) => ["apimart", "mock"].includes(job.provider) && ["draft", "submitted", "processing"].includes(job.status));
      const activeCodexImageRequest = requests[0];
      const imageChannelLocked = Boolean(activeCodexImageRequest || activeApiImageJob);
      const parentShot = shot.parentShotId ? data.shots.find((item) => item.id === shot.parentShotId) : null;
      const waitingForParent = shot.sequenceRelation === "seamless_continuation" && (!parentShot?.approvedVideoJobId || !parentShot.lastFrameMediaId || !parentShot.observedEndState);
      const shotAudioAssets = shot.audioAssetIds.map((id) => data.audioAssets.find((item) => item.id === id)).filter(Boolean);
      const missingRemoteAudio = shotAudioAssets.some((item) => !item!.remoteUrl);
      const videoStageReady = ["sample_video", "batch_generation"].includes(data.project.stage);
      const hasVideoSource = shot.sequenceRelation === "seamless_continuation" ? !waitingForParent : Boolean(shot.approvedImageMediaId);
      const canGenerateVideo = videoStageReady && hasVideoSource;
      const defaultModel = settings?.videoModel && videoModelOptions.some((item) => item.id === settings.videoModel) ? settings.videoModel : videoModelOptions[0].id;
      const defaultOption = videoModelOption(defaultModel);
      const currentVideoParams = videoParams[shot.id] ?? { model: defaultModel, resolution: (defaultOption.resolutions.includes("720p") ? "720p" : defaultOption.resolutions[0]) as VideoResolution, generateAudio: true };
      const params = paramsFor(shot.id);
      const option = imageModelOption(params.model);
      const lockedFrameMedia = shot.approvedImageMediaId ? data.mediaFiles.find((item) => item.id === shot.approvedImageMediaId && item.kind === "image") : undefined;
      return <article id={`shot-${shot.id}`} className="shot-card shot-card-generation" key={shot.id}>
        <div className="shot-number">{String(shot.shotNumber).padStart(2, "0")}</div>
        <div className="shot-main">
          <div className="card-meta"><span>{shot.duration} 秒</span><span>{shot.sceneId || "未分场景"}</span><span>{shot.sequenceRelation === "seamless_continuation" ? "连续承接" : shot.sequenceRelation === "sequence_first_clip" ? "场景首镜" : shot.sequenceRelation === "reanchor_after_drift" ? "重新定位" : "正常切镜"}</span></div>
          <div className="shot-title-row"><div><h3>{shot.title}</h3><p>{shot.narrativePurpose}</p></div><button className="ghost" disabled={!shotWriteReady} title={shotWriteReady ? "编辑镜头契约" : "当前阶段只能查看历史分镜"} onClick={() => editShot(shot)}>{shotWriteReady ? "编辑镜头契约" : "历史镜头 · 只读"}</button></div>
          {linkedAssets.length > 0 && <><div className="shot-asset-tags">{linkedAssets.map((asset) => <span key={asset.id} className={clsx(asset.referenceMediaId && "locked")}>{asset.name}{asset.referenceMediaId ? " · 已锁定参考图" : " · 无参考图"}</span>)}</div>{linkedAssets.some((asset) => asset.referenceMediaId) && <div className="shot-reference-strip">{linkedAssets.filter((asset) => asset.referenceMediaId).map((asset) => <button type="button" key={asset.id} onClick={() => setLightboxUrl(`/api/assets/${asset.id}/reference`)}><img src={`/api/assets/${asset.id}/reference`} alt={`${asset.name}参考图`} /><span>{asset.name}</span></button>)}</div>}</>}
          <div className="shot-details"><span><b>构图</b>{shot.composition}</span><span><b>动作</b>{shot.action}</span><span><b>台词</b>{shot.dialogue || "无"}</span></div>
          <div className="shot-contract-grid"><span><b>观众感受</b>{shot.feltIntent || "待补充"}</span><span><b>开始状态</b>{shot.plannedStartState || (parentShot?.observedEndState ? `承接上一镜：${parentShot.observedEndState}` : "待补充")}</span><span><b>结束目标</b>{shot.plannedEndState || "待补充"}</span><span><b>已经发生</b>{shot.alreadyHappened || "无"}</span><span><b>暂不发生</b>{shot.reservedForLater || "无"}</span><span><b>连续性锁定</b>{shot.continuityLocks || "待补充"}</span><span><b>音频策略</b>{shot.audioMode === "dialogue_lipsync" ? "成品台词驱动口型" : shot.audioMode === "voice_reference" ? "角色音色参考" : shot.audioMode === "music_sync" ? "音乐节拍驱动" : shot.audioMode === "silent" ? "无声视频" : "模型生成声音"}</span><span><b>说话人</b>{shot.speakerMap || "无明确对白分配"}</span><span><b>声音参考</b>{shotAudioAssets.map((item) => item!.name).join("、") || "未绑定"}</span></div>
          <details><summary>生图与视频提示词</summary><h4>首帧提示词</h4><p>{shot.imagePrompt}</p><h4>Seedance 提示词</h4><p>{shot.videoPrompt}</p></details>
          <div className="shot-generation-panel">
            <div><strong>首帧生成</strong><span>自动携带本镜头绑定资产的锁定参考图</span></div>
            <div className="shot-generation-params">
              <label><span>生图模型</span><select value={params.model} onChange={(e) => { const next = imageModelOption(e.target.value); updateShotParams(shot.id, { model: e.target.value, resolution: next.resolutions[0], count: next.counts[0] }); }}>{imageModelOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              <label><span>{params.model === "midjourney" ? "生成速度" : "生图质量"}</span><select value={params.resolution} onChange={(e) => updateShotParams(shot.id, { resolution: e.target.value })}>{option.resolutions.map((value) => <option key={value} value={value}>{imageResolutionLabel(params.model, value)}</option>)}</select></label>
              <label><span>画幅比例</span><select value={params.aspectRatio} onChange={(e) => updateShotParams(shot.id, { aspectRatio: e.target.value })}><option value="1:1">1:1 方形</option><option value="3:2">3:2 横向</option><option value="2:3">2:3 竖向</option><option value="4:3">4:3 横向</option><option value="3:4">3:4 竖向</option><option value="16:9">16:9 宽屏</option><option value="9:16">9:16 竖屏</option></select></label>
              <label><span>生成数量</span><select value={params.count} onChange={(e) => updateShotParams(shot.id, { count: Number(e.target.value) })}>{option.counts.map((value) => <option key={value} value={value}>{params.model === "midjourney" ? "1组四宫格" : `${value}张`}</option>)}</select></label>
            </div>
            <div className="button-row">{!data.project.dryRun && <button className="codex-generate-button" disabled={!shotImageGenerationReady || generatingShotId === shot.id || !shot.imagePrompt || imageChannelLocked} onClick={() => generateShotImage(shot, "codex")}><Sparkles size={17} />使用 Codex 额度</button>}<button className="primary" disabled={!shotImageGenerationReady || generatingShotId === shot.id || !shot.imagePrompt || (!data.project.dryRun && !settings?.hasApiKey) || imageChannelLocked} onClick={() => generateShotImage(shot, "apimart")}><Sparkles size={17} />{!shotImageGenerationReady ? "当前阶段仅可查看" : data.project.dryRun ? "本地 Mock 首帧 · 零费用" : `APIMart 付费生图 · ${imageResolutionLabel(params.model, params.resolution)}`}</button></div>
            {imageChannelLocked && <div className="image-channel-lock"><div><Status value={activeCodexImageRequest?.status ?? activeApiImageJob?.status ?? "processing"} /><span>{activeCodexImageRequest ? `当前已选择 Codex 通道，${activeCodexImageRequest.status === "queued" ? "等待对话领取" : "正在生成，通常需要几分钟"}；任务结束前 APIMart 已锁定。` : "当前已选择 APIMart 付费通道；任务完成或失败前 Codex 已锁定，避免重复费用。"}</span></div>{activeCodexImageRequest && <button className="danger" disabled={cancellingCodexRequestId === activeCodexImageRequest.id} onClick={() => cancelShotCodexRequest(activeCodexImageRequest.id)}>{cancellingCodexRequestId === activeCodexImageRequest.id ? "正在取消…" : "取消 Codex 任务并解锁"}</button>}</div>}
            {jobs.length > 0 && <div className="shot-image-results">{jobs.flatMap((job) => { const media = data.mediaFiles.filter((item) => item.jobId === job.id && item.kind === "image"); if (!media.length) return [<div className="shot-result-placeholder" key={job.id}><span>{job.status === "failed" ? "失败" : `${job.progress}%`}</span><small>{job.provider === "codex" ? "Codex" : job.model}</small></div>]; return media.map((item, index) => <article className={clsx("shot-image-candidate", shot.approvedImageMediaId === item.id && "locked")} key={item.id}><button type="button" className="shot-image-preview" onClick={() => setLightboxUrl(`/api/media/${item.id}`)}><img src={`/api/media/${item.id}`} alt={`镜头${shot.shotNumber}首帧候选${index + 1}`} /><small>{job.provider === "codex" ? "Codex" : job.model} · {index + 1}</small></button><button className={shot.approvedImageMediaId === item.id ? "ghost" : "primary"} disabled={lockingImageId === item.id} onClick={() => lockShotImage(shot.id, job.id, item.id)}>{shot.approvedImageMediaId === item.id ? "已锁定首帧" : lockingImageId === item.id ? "正在锁定…" : "锁定此图"}</button></article>); })}</div>}
            <div className="production-prompt-module image-prompt-module"><div className="production-module-heading"><div><strong>首帧生图提示词</strong><span>单独编辑画面，不混入视频动作指令</span></div><button className="ghost" onClick={() => saveShotPrompt(shot, "image")}>保存生图提示词</button></div><textarea value={promptDrafts[shot.id]?.image ?? shot.imagePrompt} onChange={(e) => setPromptDrafts((current) => ({ ...current, [shot.id]: { image: e.target.value, video: current[shot.id]?.video ?? shot.videoPrompt } }))} /></div>
          </div>
          {lockedFrameMedia && <div className="locked-shot-reference"><div><strong>已锁定首帧 · @Image{linkedAssets.filter((asset) => asset.referenceMediaId).length + 1}</strong><span>这张图是本镜头视频的首帧来源，生成视频时会自动提交。</span></div><button type="button" onClick={() => setLightboxUrl(`/api/media/${lockedFrameMedia.id}`)}><img loading="lazy" width="96" height="128" src={`/api/media/${lockedFrameMedia.id}`} alt={`镜头${shot.shotNumber}已锁定首帧`} /><span>点击放大</span></button></div>}
          <div className="shot-video-panel">
            <div className="production-prompt-module video-prompt-module"><div className="production-module-heading"><div><strong>视频生成提示词</strong><span>独立编辑动作、运镜、声音和连续性</span></div><button className="ghost" onClick={() => saveShotPrompt(shot, "video")}>保存视频提示词</button></div><textarea value={promptDrafts[shot.id]?.video ?? shot.videoPrompt} onChange={(e) => setPromptDrafts((current) => ({ ...current, [shot.id]: { image: current[shot.id]?.image ?? shot.imagePrompt, video: e.target.value } }))} /><p className="prompt-reference-hint">提交时会自动追加本镜头的 @Image、@Audio、@Video 参考职责，不会把资产 ID 写进提示词。</p></div>
            <div className="multimodal-reference-panel"><div className="production-module-heading"><div><strong>本镜头参考资产</strong><span>最多 9 张图片、3 段音频、3 段视频；提交前会检查 HTTPS 地址和模式兼容性</span></div><span className="reference-count">{shot.assetIds.length + (shot.approvedImageMediaId ? 1 : 0)} 图 · {shot.audioAssetIds.length} 音频 · {shot.videoReferenceMediaIds.length} 视频</span></div><div className="reference-asset-grid">{linkedAssets.filter((asset) => asset.referenceMediaId).map((asset, index) => <button type="button" className="reference-asset-card" key={asset.id} onClick={() => setLightboxUrl(`/api/assets/${asset.id}/reference`)}><img loading="lazy" width="72" height="96" src={`/api/assets/${asset.id}/reference`} alt={asset.name} /><b>@Image{index + 1}</b><span>{asset.name}</span></button>)}{shotAudioAssets.map((audio, index) => <div className="reference-asset-card audio-reference-card" key={audio!.id}><b>@Audio{index + 1}</b><span>{audio!.name}</span><small>{audio!.remoteUrl ? "HTTPS 已就绪" : "缺少 HTTPS 地址"}</small></div>)}{data.mediaFiles.filter((media) => media.kind === "video" && Boolean(media.sourceUrl)).map((media) => <label className={clsx("reference-asset-card", shot.videoReferenceMediaIds.includes(media.id) && "selected")} key={media.id}><input type="checkbox" checked={shot.videoReferenceMediaIds.includes(media.id)} disabled={!shot.videoReferenceMediaIds.includes(media.id) && shot.videoReferenceMediaIds.length >= 3} onChange={() => void updateShotVideoReferences(shot, media.id)} /><b>@Video{shot.videoReferenceMediaIds.indexOf(media.id) + 1 || "·"}</b><span>已完成视频参考</span><small>HTTPS 已就绪</small></label>)}</div>{(shot.audioAssetIds.length > 0 || shot.videoReferenceMediaIds.length > 0) && <p className="compatibility-note">已绑定音频或视频参考，系统会使用普通 image_urls 多模态模式；不会同时提交首尾帧 image_with_roles。</p>}</div>
            <div className="shot-video-heading"><div><strong>Seedance 2.0 视频生产</strong><span>{!videoStageReady ? "完整分镜通过后解锁视频生成；现在可先锁定首帧" : waitingForParent ? `等待上一镜头“${parentShot?.title ?? "未指定"}”通过并记录尾帧` : shot.sequenceRelation === "seamless_continuation" ? "自动使用上一镜头已通过尾帧作为当前首帧" : shot.approvedImageMediaId ? "已锁定首帧，可以生成视频" : "请先从上方候选图中锁定首帧"}</span></div><Status value={shot.approvedVideoJobId ? "completed" : canGenerateVideo ? "draft" : "submitted"} /></div>
            <div className="shot-video-settings"><label>视频模型<select value={currentVideoParams.model} onChange={(e) => { const next = videoModelOption(e.target.value); setVideoParams((current) => ({ ...current, [shot.id]: { ...currentVideoParams, model: e.target.value, resolution: (next.resolutions.includes(currentVideoParams.resolution) ? currentVideoParams.resolution : next.resolutions[0]) as VideoResolution } })); }}>{videoModelOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>分辨率<select value={currentVideoParams.resolution} onChange={(e) => setVideoParams((current) => ({ ...current, [shot.id]: { ...currentVideoParams, resolution: e.target.value as VideoResolution } }))}>{(["480p", "720p", "1080p"] as VideoResolution[]).map((value) => <option key={value} value={value} disabled={!videoModelOption(currentVideoParams.model).resolutions.includes(value)}>{value} {value === "480p" ? "轻量预览" : value === "720p" ? "制作版" : "精细版"}{!videoModelOption(currentVideoParams.model).resolutions.includes(value) ? "（当前模型不支持）" : ""}</option>)}</select></label><label>声音<select value={currentVideoParams.generateAudio ? "yes" : "no"} onChange={(e) => setVideoParams((current) => ({ ...current, [shot.id]: { ...currentVideoParams, generateAudio: e.target.value === "yes" } }))} disabled={shot.audioMode === "silent"}><option value="yes">生成/使用参考声音</option><option value="no">无声视频</option></select></label><button className="primary" disabled={!canGenerateVideo || (!data.project.dryRun && !settings?.hasApiKey) || !shot.videoPrompt || generatingShotId === shot.id || missingRemoteAudio} onClick={() => generateShotVideo(shot)}><Video size={17} />{generatingShotId === shot.id ? "正在提交…" : data.project.dryRun ? "生成本地 Mock 视频 · 零费用" : "生成当前镜头视频"}</button></div>
            {shotAudioAssets.length > 0 && <div className="shot-audio-reference-list">{shotAudioAssets.map((item, index) => <div key={item!.id}><strong>@Audio{index + 1} · {item!.name}</strong><span>{item!.type === "dialogue_line" ? "台词与口型" : item!.type === "character_voice" ? "角色音色" : item!.type === "music" ? "音乐节拍" : item!.type === "ambience" ? "环境声" : "关键音效"}</span>{item!.localPath && <audio controls src={`/api/audio-assets/${item!.id}/file`} />}{item!.remoteUrl ? <small>APIMart地址已就绪</small> : <small className="error-text">缺少 HTTPS 远程地址，暂不能生成</small>}</div>)}</div>}
            {videoJobs.length > 0 && <div className="shot-video-results">{videoJobs.map((job) => { const videoMedia = data.mediaFiles.find((item) => item.jobId === job.id && item.kind === "video"); return <article className={clsx("shot-video-result", shot.approvedVideoJobId === job.id && "locked")} key={job.id}><div className="shot-video-preview">{videoMedia ? <video src={`/api/media/${videoMedia.id}`} controls /> : <div className="processing"><Sparkles /><span>{job.status === "failed" ? job.error : `${job.progress}%`}</span></div>}</div><div><div className="media-status-row"><Status value={job.status} />{shot.approvedVideoJobId === job.id && <span className="approved-result-badge">已通过版本</span>}</div><small>{job.model} · {job.cost ? `$${job.cost.toFixed(3)}` : "等待费用回传"}</small>{job.status === "completed" && <><label>真实结束状态<textarea value={observedStates[shot.id] ?? shot.observedEndState ?? shot.plannedEndState} onChange={(e) => setObservedStates((current) => ({ ...current, [shot.id]: e.target.value }))} placeholder="例如：猫掌柜站在柜台右侧，右手按住黑色箱子，镜头停止推近。" /></label><label>声音与口型验收<textarea value={observedAudioStates[shot.id] ?? shot.observedAudioState} onChange={(e) => setObservedAudioStates((current) => ({ ...current, [shot.id]: e.target.value }))} placeholder="记录音色是否一致、说话人是否正确、口型是否同步、MV节拍是否命中、是否需要后期重配。" /></label><label>退回意见<textarea value={videoFeedback[shot.id] ?? ""} onChange={(e) => setVideoFeedback((current) => ({ ...current, [shot.id]: e.target.value }))} placeholder="退回时说明首帧、动作、镜头、连续性、音色、口型或节拍问题。" /></label><div className="button-row"><button className="danger" disabled={videoReviewingId === job.id} onClick={() => reviewShotVideo(shot, job.id, "rejected")}>退回此版本</button><button className="primary" disabled={videoReviewingId === job.id} onClick={() => reviewShotVideo(shot, job.id, "approved")}>{videoReviewingId === job.id ? "正在确认…" : "通过并记录音画状态"}</button></div></>}</div></article>; })}</div>}
            {shot.lastFrameMediaId && <button type="button" className="shot-last-frame" onClick={() => setLightboxUrl(`/api/media/${shot.lastFrameMediaId}`)}><img src={`/api/media/${shot.lastFrameMediaId}`} alt={`镜头${shot.shotNumber}已通过尾帧`} /><span><b>已记录尾帧</b>{shot.observedEndState}</span></button>}
          </div>
        </div>
        <Status value={shot.status === "approved" ? "completed" : "draft"} />
      </article>;
    })}{data.shots.length === 0 && <section className="panel prerequisite-panel"><Clapperboard size={26} /><div><h2>等待分镜 Agent 写入镜头</h2><p>当前已经进入分镜设计，但还没有镜头。你可以等待 Agent 写入，或展开下方人工补录入口。</p></div></section>}</div>
    {shotWriteReady ? <section className={clsx("panel shot-form", (data.shots.length === 0 || form.id) && "manual-entry-visible")}><div className="shot-form-heading"><div><h2>{form.id ? `编辑镜头 ${form.shotNumber}` : "人工补录镜头"}</h2><p>先定义这条视频只负责什么、从哪里开始、停在哪里，再写提示词。</p></div>{form.id && <button className="ghost" onClick={() => setForm({ ...emptyShotForm, shotNumber: nextNumber, sequenceRelation: nextNumber === 1 ? "sequence_first_clip" : "intentional_next_shot" })}>取消编辑</button>}</div><div className="form-grid"><label>镜头号<input type="number" value={form.shotNumber} onChange={(e) => setForm({ ...form, shotNumber: Number(e.target.value) })} /></label><label>标题<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label>时长（4—15秒）<input type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} /></label><label>场景编号<input value={form.sceneId} onChange={(e) => setForm({ ...form, sceneId: e.target.value })} placeholder="scene-01" /></label></div><div className="form-grid"><label>镜头关系<select value={form.sequenceRelation} onChange={(e) => setForm({ ...form, sequenceRelation: e.target.value as typeof form.sequenceRelation })}><option value="sequence_first_clip">场景首镜</option><option value="intentional_next_shot">正常切镜</option><option value="seamless_continuation">无缝承接上一镜</option><option value="reanchor_after_drift">漂移后重新定位</option></select></label><label>上一镜头<select value={form.parentShotId ?? ""} onChange={(e) => setForm({ ...form, parentShotId: e.target.value || null })}><option value="">无</option>{data.shots.filter((shot) => shot.id !== form.id).map((shot) => <option key={shot.id} value={shot.id}>镜头 {shot.shotNumber} · {shot.title}</option>)}</select></label><label>运镜<input value={form.camera} onChange={(e) => setForm({ ...form, camera: e.target.value })} /></label><label>观众应感受到<input value={form.feltIntent} onChange={(e) => setForm({ ...form, feltIntent: e.target.value })} placeholder="例如：先紧张，最后意识到荒唐" /></label></div><div className="shot-asset-picker"><strong>本镜头引用的资产</strong><p>选择人物、场景和道具。生成分镜首帧时会自动携带这些资产已锁定的参考图。</p><div>{data.assets.map((asset) => <label key={asset.id} className={clsx(form.assetIds.includes(asset.id) && "selected")}><input type="checkbox" checked={form.assetIds.includes(asset.id)} onChange={() => setForm((current) => ({ ...current, assetIds: current.assetIds.includes(asset.id) ? current.assetIds.filter((id) => id !== asset.id) : [...current.assetIds, asset.id] }))} /><span>{asset.name}</span><small>{asset.referenceMediaId ? "已锁定参考图" : "无参考图"}</small></label>)}</div></div><div className="shot-audio-contract"><div className="form-grid"><label>声音模式<select value={form.audioMode} onChange={(e) => setForm({ ...form, audioMode: e.target.value as typeof form.audioMode, audioAssetIds: e.target.value === "generated" || e.target.value === "silent" ? [] : form.audioAssetIds })}><option value="generated">Seedance自行生成声音</option><option value="voice_reference">角色音色参考</option><option value="dialogue_lipsync">成品台词驱动口型</option><option value="music_sync">音乐片段驱动MV节拍</option><option value="silent">无声视频，后期配音</option></select></label><label>说话人分配<input value={form.speakerMap} onChange={(e) => setForm({ ...form, speakerMap: e.target.value })} placeholder="猫掌柜：台词；阿强：不说话" /></label><label>声音设计<input value={form.audioDirection} onChange={(e) => setForm({ ...form, audioDirection: e.target.value })} placeholder="雨声、近距离干声、台词后静音半秒" /></label><label>口型约束<input value={form.lipSyncNotes} onChange={(e) => setForm({ ...form, lipSyncNotes: e.target.value })} placeholder="中近景稳定机位，不转头，不做大幅手势" /></label></div>{!['generated','silent'].includes(form.audioMode) && <div className="audio-asset-picker"><strong>绑定声音参考（最多3个）</strong><p>角色音色、成品台词或MV音乐片段必须来自声音资产库。音乐请按当前镜头切成15秒以内片段。</p><div>{data.audioAssets.map((audio) => <label key={audio.id} className={clsx(form.audioAssetIds.includes(audio.id) && "selected")}><input type="checkbox" checked={form.audioAssetIds.includes(audio.id)} disabled={!form.audioAssetIds.includes(audio.id) && form.audioAssetIds.length >= 3} onChange={() => setForm((current) => ({ ...current, audioAssetIds: current.audioAssetIds.includes(audio.id) ? current.audioAssetIds.filter((id) => id !== audio.id) : [...current.audioAssetIds, audio.id] }))} /><span>{audio.name}</span><small>{audio.remoteUrl ? "APIMart已就绪" : "只有本地试听文件"}</small></label>)}</div></div>}</div><textarea placeholder="叙事目的：这条视频只完成什么剧情任务" value={form.narrativePurpose} onChange={(e) => setForm({ ...form, narrativePurpose: e.target.value })} /><textarea placeholder="计划开始状态：人物位置、姿势、道具和镜头起点" value={form.plannedStartState} onChange={(e) => setForm({ ...form, plannedStartState: e.target.value })} /><textarea placeholder="计划结束状态：这条视频必须停在哪里" value={form.plannedEndState} onChange={(e) => setForm({ ...form, plannedEndState: e.target.value })} /><textarea placeholder="已经发生：禁止这一镜重复的剧情" value={form.alreadyHappened} onChange={(e) => setForm({ ...form, alreadyHappened: e.target.value })} /><textarea placeholder="暂不发生：必须留给后续镜头的剧情" value={form.reservedForLater} onChange={(e) => setForm({ ...form, reservedForLater: e.target.value })} /><textarea placeholder="连续性锁定：人物身份、服装、道具、方向、灯光等不能改变的内容" value={form.continuityLocks} onChange={(e) => setForm({ ...form, continuityLocks: e.target.value })} /><textarea placeholder="允许变化：模型可自由发挥的次要部分" value={form.allowedChanges} onChange={(e) => setForm({ ...form, allowedChanges: e.target.value })} /><textarea placeholder="构图" value={form.composition} onChange={(e) => setForm({ ...form, composition: e.target.value })} /><textarea placeholder="角色动作与表演" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} /><textarea placeholder="台词" value={form.dialogue} onChange={(e) => setForm({ ...form, dialogue: e.target.value })} /><textarea placeholder="分镜首帧生图提示词" value={form.imagePrompt} onChange={(e) => setForm({ ...form, imagePrompt: e.target.value })} /><textarea placeholder="Seedance 2.0 当前镜头自然语言提示词" value={form.videoPrompt} onChange={(e) => setForm({ ...form, videoPrompt: e.target.value })} /><button className="primary" onClick={save}>{form.id ? "保存镜头契约修改" : "保存镜头"}</button></section> : <section className="panel prerequisite-panel"><LockKeyhole size={26} /><div><h2>历史分镜只读</h2><p>当前项目已经进入成片审核或完成阶段。如需修改，请先在成片审核中退回到批量生成阶段。</p></div></section>}
    <section className="panel audio-library"><div className="shot-form-heading"><div><h2>声音资产库</h2><p>统一管理角色音色、场景母带、成品台词、MV音乐片段、环境声和关键音效。</p></div><span>{data.audioAssets.length} 项</span></div><div className="audio-library-grid">{data.audioAssets.map((audio) => <article key={audio.id}><div><strong>{audio.name}</strong><span>{audio.type === "character_voice" ? "角色音色" : audio.type === "dialogue_line" ? "成品台词" : audio.type === "scene_master" ? "场景母带" : audio.type === "music" ? "音乐片段" : audio.type === "ambience" ? "环境声" : "关键音效"}</span></div>{audio.localPath && <audio controls src={`/api/audio-assets/${audio.id}/file`} />}<p>{audio.description || "暂无说明"}</p><small>{audio.duration ? `${audio.duration}秒 · ` : ""}{audio.remoteUrl ? "APIMart远程地址已就绪" : "仅本地存档，不能提交生成"}</small><em>{audio.rightsNote}</em></article>)}{!data.audioAssets.length && <Empty text="还没有声音资产。对白短片建议先生成场景母带，再切分镜头片段。" />}</div><div className="audio-create-form"><select value={audioForm.type} onChange={(e) => setAudioForm({ ...audioForm, type: e.target.value })}><option value="character_voice">角色音色</option><option value="dialogue_line">成品台词</option><option value="scene_master">场景对白母带</option><option value="music">MV音乐片段</option><option value="ambience">环境声</option><option value="sfx">关键音效</option></select><input value={audioForm.name} onChange={(e) => setAudioForm({ ...audioForm, name: e.target.value })} placeholder="声音资产名称" /><select value={audioForm.characterAssetId} onChange={(e) => setAudioForm({ ...audioForm, characterAssetId: e.target.value })}><option value="">不绑定角色</option>{data.assets.filter((asset) => asset.type === "character").map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><input type="number" min="0" max="900" value={audioForm.duration} onChange={(e) => setAudioForm({ ...audioForm, duration: e.target.value })} placeholder="时长秒数" /><input value={audioForm.remoteUrl} onChange={(e) => setAudioForm({ ...audioForm, remoteUrl: e.target.value })} placeholder="APIMart可访问的HTTPS音频地址" /><input value={audioForm.rightsNote} onChange={(e) => setAudioForm({ ...audioForm, rightsNote: e.target.value })} placeholder="权利说明：本人录制/已授权/商用音乐许可" /><input value={audioForm.description} onChange={(e) => setAudioForm({ ...audioForm, description: e.target.value })} placeholder="用途、语气、BPM、歌词段落或节拍说明" /><label className="reference-upload-button"><input type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/aac" onChange={(e) => setAudioFile(e.target.files?.[0])} /><span>{audioFile?.name ?? "选择本地试听文件"}</span></label><button className="primary" disabled={creatingAudio} onClick={createAudioAsset}>{creatingAudio ? "正在保存…" : "保存声音资产"}</button></div></section>
    {data.project.stage === "batch_generation" && data.shots.length > 0 && data.shots.every((shot) => Boolean(shot.approvedVideoJobId)) && <section className="panel preview-ready-panel"><Film size={28} /><div><h2>全部镜头视频已经通过</h2><p>现在可以创建一个新的成片预览版本。生成后会自动进入成片审核页，刷新也不会丢失。</p></div><button className="primary" disabled={buildingPreview} onClick={() => void buildFinalPreview()}>{buildingPreview ? "正在生成预览…" : "生成预览片并进入审核"}</button></section>}
    {lightboxUrl && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="分镜首帧大图" onClick={() => setLightboxUrl("")}><button type="button" className="icon-button" aria-label="关闭大图" onClick={() => setLightboxUrl("")}><X /></button><img src={lightboxUrl} alt="分镜首帧大图" onClick={(event) => event.stopPropagation()} /></div>}
    {data.project.stage === "storyboard_user_review" && data.shots.length > 0 && <section className="approval-bar"><div><strong>完整分镜审核</strong><span>通过后进入代表性镜头样片制作。</span></div><label className="visually-compact-label">退回原因<input value={reviewFeedback} onChange={(e) => setReviewFeedback(e.target.value)} placeholder="退回时必须填写具体原因" /></label><button className="danger" onClick={() => approve("rejected")}>退回</button><button className="primary" onClick={() => approve("approved")}>分镜通过</button></section>}
  </>;
}

function GeneratePage({ data, reload, kind }: { data: DashboardData; reload: () => Promise<void>; kind: "image" | "video" }) {
  if (kind === "video") return <VideoSupervisionPage data={data} />;
  const [settings, setSettings] = useState<{ imageModel: string; imageResolution: string; videoModel: string; defaultProvider: "mock" | "apimart" } | null>(null);
  const [shotId, setShotId] = useState(data.shots[0]?.id ?? "");
  const shot = data.shots.find((item) => item.id === shotId);
  const [prompt, setPrompt] = useState(kind === "image" ? shot?.imagePrompt ?? "" : shot?.videoPrompt ?? "");
  const [message, setMessage] = useState("");
  useEffect(() => { void api.settings().then(setSettings); }, []);
  useEffect(() => { setPrompt(kind === "image" ? shot?.imagePrompt ?? "" : shot?.videoPrompt ?? ""); }, [shotId, kind, shot]);
  async function generate() { if (!settings || !shot) return; try { const provider = data.project.dryRun ? "mock" : settings.defaultProvider; await api.createJob(data.project.id, { shotId: shot.id, kind, provider, model: kind === "image" ? settings.imageModel : settings.videoModel, prompt, params: kind === "image" ? { size: data.project.aspectRatio, resolution: settings.imageResolution, quality: "high", n: 1 } : { size: data.project.aspectRatio, resolution: "720p", duration: Math.max(4, Math.min(15, shot.duration)), generate_audio: true, return_last_frame: true }, batch: data.project.stage === "batch_generation" }); setMessage(data.project.dryRun ? "本地 Mock 任务已提交，不会产生API费用。" : "任务已提交，可在任务中心查看进度。"); await reload(); } catch (e) { setMessage((e as Error).message); } }
  async function approve(approved: boolean) { if (!shot) return; try { await api.sampleApproval(data.project.id, { shotId: shot.id, kind, approved, feedback: message }); await reload(); } catch (e) { setMessage((e as Error).message); } }
  const jobs = data.jobs.filter((job) => job.kind === kind);
  return <><PageHeader eyebrow={kind === "image" ? "GPT-IMAGE-2 LAB" : "SEEDANCE 2.0 STAGE"} title={kind === "image" ? "专业生图台" : "视频生成台"} description={kind === "image" ? "先用代表性镜头确认角色、风格和构图，再批量生成。" : "每条视频保存真实结束状态和尾帧，后续镜头以已通过画面为准。"} /><div className="generate-layout"><section className="panel"><label>选择镜头<select value={shotId} onChange={(e) => setShotId(e.target.value)}>{data.shots.map((s) => <option key={s.id} value={s.id}>镜头 {s.shotNumber} · {s.title}</option>)}</select></label><div className="shot-brief"><span>{shot?.duration ?? 0} 秒</span><span>{shot?.camera || "未设置运镜"}</span><span>{data.project.aspectRatio}</span></div><label>{kind === "image" ? "gpt-image-2 提示词" : "Seedance 2.0 提示词"}<textarea className="prompt-editor" value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label><div className="button-row"><button className="primary" onClick={generate}><Sparkles size={17} /> {data.project.dryRun || settings?.defaultProvider === "mock" ? "免费模拟生成" : "确认付费生成"}</button></div>{message && <p className="notice">{message}</p>}</section><aside className="panel"><p className="eyebrow">QUALITY CHECK</p><h2>生成前检查</h2><ul className="check-list">{(kind === "image" ? ["角色身份锚点明确", "构图与画幅一致", "光线和色彩有明确目的", "没有互相冲突的描述", "锁定禁止变化项"] : ["只有一个主要可见事件", "只有一个主要运镜", "使用已通过首帧", "动作承接上一镜头结束状态", "返回尾帧用于连续镜头"]).map((item) => <li key={item}><span>✓</span>{item}</li>)}</ul><hr /><h3>样片审核</h3><p>只有代表性图片和视频都通过，才能进入全片批量生成。</p><div className="button-row"><button className="danger" onClick={() => approve(false)}>不满意</button><button className="primary" onClick={() => approve(true)}>样片通过</button></div></aside></div><section className="media-grid">{jobs.map((job) => <MediaCard key={job.id} job={job} />)}{!jobs.length && <Empty text={`还没有${kind === "image" ? "图片" : "视频"}任务。`} />}</section></>;
}

function VideoSupervisionPage({ data }: { data: DashboardData }) {
  const videoJobs = data.jobs.filter((job) => job.kind === "video");
  const completedShots = data.shots.filter((shot) => shot.approvedVideoJobId).length;
  return <><PageHeader eyebrow="SEEDANCE SUPERVISION" title="视频监制台" description="视频从分镜台逐镜头发起；这里集中查看版本、费用、连续性结果和下一镜头解锁状态。" /><section className="video-supervision-summary"><div><strong>{completedShots}/{data.shots.length}</strong><span>镜头视频已通过</span></div><div><strong>{videoJobs.filter((job) => ["draft", "submitted", "processing"].includes(job.status)).length}</strong><span>正在生成</span></div><div><strong>{videoJobs.filter((job) => job.status === "failed").length}</strong><span>失败任务</span></div><div><strong>${videoJobs.reduce((sum, job) => sum + job.cost, 0).toFixed(3)}</strong><span>已回传费用</span></div></section><div className="video-supervision-list">{data.shots.map((shot) => { const jobs = videoJobs.filter((job) => job.shotId === shot.id); const parent = shot.parentShotId ? data.shots.find((item) => item.id === shot.parentShotId) : null; return <section className="panel video-supervision-shot" key={shot.id}><header><div><p className="eyebrow">SHOT {String(shot.shotNumber).padStart(2, "0")}</p><h2>{shot.title}</h2><span>{shot.sequenceRelation === "seamless_continuation" ? `连续承接：${parent?.title ?? "未指定"}` : "独立切镜或重新定位"}</span></div><Status value={shot.approvedVideoJobId ? "completed" : jobs.some((job) => ["draft", "submitted", "processing"].includes(job.status)) ? "processing" : "draft"} /></header><div className="video-supervision-contract"><span><b>镜头任务</b>{shot.narrativePurpose}</span><span><b>结束目标</b>{shot.plannedEndState || "待补充"}</span><span><b>真实结束</b>{shot.observedEndState || "尚未通过视频"}</span></div>{shot.lastFrameMediaId && <button className="video-tail-preview"><img src={`/api/media/${shot.lastFrameMediaId}`} alt={`${shot.title}尾帧`} /><span>已通过尾帧</span></button>}<div className="media-grid compact-video-grid">{jobs.map((job) => <MediaCard key={job.id} job={job} approved={shot.approvedVideoJobId === job.id} />)}{!jobs.length && <Empty text="该镜头还没有视频版本，请前往分镜台生成。" />}</div></section>; })}</div></>;
}

function MediaCard({ job, approved = false }: { job: DashboardData["jobs"][number]; approved?: boolean }) {
  const [lightboxUrl, setLightboxUrl] = useState("");
  const output = job.output as { localPaths?: string[] };
  const path = output?.localPaths?.[0];
  const url = path ? `/api/files?path=${encodeURIComponent(path)}` : "";
  useEffect(() => {
    if (!lightboxUrl) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setLightboxUrl(""); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [lightboxUrl]);
  return <>
    <article className={clsx("media-card", approved && "approved-result")}><div className="media-preview">{url ? job.kind === "video" ? <video src={url} controls /> : <button type="button" className="media-image-button" onClick={() => setLightboxUrl(url)} aria-label="点击放大生成图片"><img src={url} alt="生成结果" /><span>点击放大</span></button> : <div className="processing"><Sparkles /><span>{job.status === "failed" ? job.error : `${job.progress}%`}</span></div>}</div><div><div className="media-status-row"><Status value={job.status} />{approved && <span className="approved-result-badge">已锁定结果</span>}</div><h3>{job.model}</h3><p>{job.prompt.slice(0, 90)}</p><div className="card-meta"><span>${job.cost.toFixed(3)}</span><span>{new Date(job.createdAt).toLocaleString()}</span></div></div></article>
    {lightboxUrl && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="生成图片大图预览" onClick={() => setLightboxUrl("")}><button type="button" className="icon-button" aria-label="关闭大图" onClick={() => setLightboxUrl("")}><X /></button><img src={lightboxUrl} alt="生成图片大图预览" onClick={(event) => event.stopPropagation()} /></div>}
  </>;
}

function JobsPage({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (status: string, kind: string, provider: string, text: string) =>
    (showCancelled || status !== "cancelled")
    && (statusFilter === "all" || status === statusFilter)
    && (kindFilter === "all" || kind === kindFilter)
    && (providerFilter === "all" || provider === providerFilter)
    && (!normalizedQuery || text.toLocaleLowerCase().includes(normalizedQuery));
  const jobs = sortTasks(data.jobs.filter((job) => {
    const object = taskObject(job, data.assets, data.shots);
    return matches(job.status, job.kind, job.provider, `${object.label} ${object.detail} ${job.model} ${job.prompt} ${job.error}`);
  }));
  const codexRequests = sortTasks(data.codexImageRequests.filter((request) => {
    const object = codexTaskObject(request, data.assets, data.shots);
    return matches(request.status, "image", "codex", `${object.label} ${object.detail} ${request.prompt} ${request.error}`);
  }));
  async function retry(id: string) { await api.retryJob(id); await reload(); }
  function openSource(section: "assets" | "storyboard" | "jobs", sourceId: string | null) {
    if (!sourceId || section === "jobs") return;
    navigate(section === "assets" ? `${projectRoute(data.project.id, "assets")}?asset=${encodeURIComponent(sourceId)}` : `${projectRoute(data.project.id, "storyboard")}#shot-${sourceId}`);
  }
  return <><PageHeader eyebrow="GENERATION QUEUE" title="任务中心" description="默认优先显示处理中和失败任务；对象名称放在前面，内部任务编号只作为排查信息。" />
    <section className="panel task-filter-bar" aria-label="任务筛选"><label>关键词<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资产、镜头、模型、提示词或错误" /></label><label>状态<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">全部状态</option><option value="processing">处理中</option><option value="failed">失败</option><option value="submitted">已提交</option><option value="queued">等待 Codex</option><option value="draft">待提交</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label><label>类型<select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="all">全部类型</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option><option value="preview">预览</option></select></label><label>生成通道<select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}><option value="all">全部通道</option><option value="codex">Codex</option><option value="apimart">APIMart</option><option value="volcengine">火山豆包</option><option value="mock">Mock</option></select></label><label className="inline-check"><input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} />显示已取消任务</label></section>
    {data.codexImageRequests.length > 0 && <section className="panel table-wrap codex-queue"><h2>Codex 额度生图</h2><table><thead><tr><th>对象</th><th>画幅/质量</th><th>状态</th><th>创建时间</th><th>说明/操作</th></tr></thead><tbody>{codexRequests.map((request) => { const object = codexTaskObject(request, data.assets, data.shots); return <tr key={request.id}><td><div className="task-object"><strong>{object.label}</strong><small>{object.detail}</small></div></td><td>{request.aspectRatio} / {request.quality === "high" ? "高质量" : "标准"}</td><td><Status value={request.status} /></td><td>{new Date(request.createdAt).toLocaleString()}</td><td><div className="task-actions"><span>{request.error || (request.status === "queued" ? "等待 Codex 对话领取" : request.status === "processing" ? "Codex 正在生成" : request.resultJobId ? "已导入生成记录" : "")}</span>{object.sourceId && <button className="ghost" onClick={() => openSource(object.section, object.sourceId)}>打开{object.section === "assets" ? "资产" : "镜头"}</button>}</div></td></tr>; })}</tbody></table>{!codexRequests.length && <Empty text="当前筛选下没有 Codex 任务。" />}</section>}
    <section className="panel table-wrap"><h2>API 与本地任务</h2><table><thead><tr><th>对象</th><th>类型/通道</th><th>模型</th><th>状态</th><th>进度</th><th>费用</th><th>错误/操作</th></tr></thead><tbody>{jobs.map((job) => { const object = taskObject(job, data.assets, data.shots); return <tr key={job.id}><td><div className="task-object"><strong>{object.label}</strong><small>{object.detail}</small></div></td><td>{job.kind === "image" ? "图片" : job.kind === "video" ? "视频" : job.kind === "audio" ? "音频" : "预览"}<small className="task-channel">{job.provider}</small></td><td>{job.provider === "codex" ? "gpt-image-2" : job.model}</td><td><Status value={job.status} /></td><td><div className="progress"><i style={{ width: `${job.progress}%` }} /></div></td><td>{job.provider === "codex" ? "Codex额度" : `$${job.cost.toFixed(3)} / ${job.creditsCost.toFixed(2)}积分`}</td><td><div className="task-actions">{job.error && <span className="error-text">{job.error}</span>}{job.status === "failed" && job.provider !== "codex" && <button className="ghost" onClick={() => retry(job.id)}>重试</button>}{object.sourceId && <button className="ghost" onClick={() => openSource(object.section, object.sourceId)}>打开{object.section === "assets" ? "资产" : "镜头"}</button>}</div></td></tr>; })}</tbody></table>{!jobs.length && <Empty text="当前筛选下没有 API 或本地任务。" />}</section></>;
}

function PreviewPage({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const exports = useMemo(() => data.artifacts.filter((artifact) => artifact.type === "final_export").slice().sort((a, b) => b.version - a.version), [data.artifacts]);
  const latest = exports[0];
  const latestContent = latest?.content && typeof latest.content === "object" ? latest.content as { localPath?: string; url?: string; createdAt?: string } : {};
  const [preview, setPreview] = useState(latestContent.url ?? "");
  const [feedback, setFeedback] = useState("");
  const [message, setMessage] = useState("");
  const [building, setBuilding] = useState(false);
  const userCanReview = data.project.stage === "final_review" && Boolean(latest && preview);
  const allVideosApproved = data.shots.length > 0 && data.shots.every((shot) => Boolean(shot.approvedVideoJobId));
  useEffect(() => { setPreview(latestContent.url ?? ""); }, [latest?.id, latestContent.url]);
  async function build() {
    if (!allVideosApproved || building) return;
    setBuilding(true); setMessage("");
    try { const result = await api.preview(data.project.id); setPreview(result.url); await reload(); }
    catch (e) { setMessage((e as Error).message); } finally { setBuilding(false); }
  }
  async function review(decision: "approved" | "rejected") {
    if (!latest || !userCanReview) return setMessage("当前还没有可审核的预览版本。");
    if (decision === "rejected" && !feedback.trim()) return setMessage("退回成片前，请填写具体问题镜头和修改方向。");
    if (decision === "approved" && !window.confirm(`确认通过成片预览 V${latest.version}？\n\n将锁定：当前预览版本 ${latest.title}\n下一阶段：项目完成\n\n旧预览仍会保留为历史版本。`)) return;
    try {
      await api.review(data.project.id, { gate: "final_user", artifactId: latest.id, decision, scores: {}, feedback: feedback.trim(), category: "成片意见" });
      setFeedback(""); await reload();
    } catch (e) { setMessage((e as Error).message); }
  }
  return <><PageHeader eyebrow="FINAL CUT" title="成片预览" description="每次生成都会保存为独立版本；刷新页面后仍会恢复最新预览，旧版本保留为历史。" actions={<button className="primary" disabled={!allVideosApproved || building} title={allVideosApproved ? "创建新的预览版本" : "全部镜头视频通过后才能生成"} onClick={build}><Film size={17} />{building ? "正在生成…" : latest ? "重新生成预览版本" : "生成预览片"}</button>} />
    <section className="preview-layout"><div className="preview-screen">{preview ? <video src={preview} controls /> : <div><Film size={48} /><p>全部镜头视频通过后，系统才会生成并保存预览片。</p></div>}</div><aside className="panel final-review-panel"><h2>最终审核</h2>{latest ? <div className="preview-version-summary"><strong>当前 V{latest.version}</strong><span>{latestContent.createdAt ? new Date(latestContent.createdAt).toLocaleString() : new Date(latest.createdAt).toLocaleString()}</span></div> : <p className="notice">还没有预览版本，不能进行成片审核。</p>}{userCanReview && <><label>退回意见<textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="退回时必须说明具体问题镜头和修改方向" /></label><div className="button-row"><button className="danger" onClick={() => review("rejected")}>退回镜头</button><button className="primary" onClick={() => review("approved")}>成片通过</button></div></>}{!userCanReview && latest && <p className="notice">{data.project.stage === "completed" ? "该预览版本已经完成最终审核。" : "只有进入成片审核阶段后才会显示审核操作。"}</p>}{message && <p className="notice" aria-live="polite">{message}</p>}<div className="preview-history"><strong>历史版本</strong>{exports.map((artifact, index) => { const content = artifact.content && typeof artifact.content === "object" ? artifact.content as { url?: string; createdAt?: string } : {}; return <button key={artifact.id} className={index === 0 ? "active" : ""} disabled={!content.url} onClick={() => content.url && setPreview(content.url)}><span>V{artifact.version}{index === 0 ? " · 最新" : " · 历史"}</span><small>{content.createdAt ? new Date(content.createdAt).toLocaleString() : new Date(artifact.createdAt).toLocaleString()}</small></button>; })}</div></aside></section></>;
}

function SkillsPage({ data }: { data: DashboardData }) {
  return <><PageHeader eyebrow="AGENT KNOWLEDGE" title="Skill 状态" description="这里显示生图与视频 Agent 实际使用的知识版本和校验结果。" /><section className="skill-grid">{data.skillStatus.map((skill) => <article className="panel skill-card" key={String(skill.name)}><div className="skill-icon"><Sparkles /></div><div><div className="card-meta"><span>V{String(skill.version)}</span><span className={clsx("status", skill.valid ? "completed" : "failed")}>{skill.valid ? "校验通过" : "未通过"}</span></div><h2>{String(skill.name)}</h2><p>{String(skill.source)}</p><code>{String(skill.commitHash || skill.checksum || "等待同步")}</code><small>{String(skill.details || "")}</small></div></article>)}{!data.skillStatus.length && <Empty text="Skills 尚未同步，完成安装后这里会显示版本。" />}</section></>;
}

function LegacySettingsPage() {
  const [form, setForm] = useState({ apiKey: "", imageModel: "gpt-image-2-official", imageResolution: "2k", videoModel: "doubao-seedance-2.0", defaultProvider: "mock" as "mock" | "apimart" });
  const [message, setMessage] = useState("");
  useEffect(() => { api.settings().then((value) => { const option = imageModelOption(value.imageModel); setForm((old) => ({ ...old, ...value, imageModel: option.id, imageResolution: option.resolutions.includes(value.imageResolution as never) ? value.imageResolution : option.resolutions[0], apiKey: "" })); }).catch((e: Error) => setMessage(e.message)); }, []);
  async function save() { try { await api.saveSettings(form); setMessage("设置已安全保存。API Key 已使用 Windows 当前用户加密。" ); setForm({ ...form, apiKey: "" }); } catch (e) { setMessage((e as Error).message); } }
  async function test() { try { const result = await api.testSettings("apimart", form.apiKey || undefined); setMessage(result.message); } catch (e) { setMessage((e as Error).message); } }
  const settingsModel = imageModelOption(form.imageModel);
  return <><PageHeader eyebrow="LOCAL SECURITY" title="API 设置" description="真实 API Key 只保存在本机后端，浏览器和日志都不会读取密钥明文。" /><section className="settings-grid"><div className="panel"><h2>APIMart 连接</h2><label>API Key<input type="password" autoComplete="new-password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="已有密钥时留空表示不修改" /></label><label>默认运行模式<select value={form.defaultProvider} onChange={(e) => setForm({ ...form, defaultProvider: e.target.value as "mock" | "apimart" })}><option value="mock">Mock 免费模拟</option><option value="apimart">APIMart 真实生成</option></select></label><div className="security-note"><KeyRound /><p><b>安全说明</b>测试连接只查询 API Key 余额，不会生成图片或视频，也不会产生生成费用。真实生成仍必须由你点击按钮确认。</p></div></div><div className="panel"><h2>模型默认值</h2><label>生图模型<select value={form.imageModel} onChange={(e) => { const option = imageModelOption(e.target.value); setForm({ ...form, imageModel: e.target.value, imageResolution: option.resolutions[0] }); }}>{imageModelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label>{form.imageModel === "midjourney" ? "默认生成速度" : "默认图片分辨率"}<select value={form.imageResolution} onChange={(e) => setForm({ ...form, imageResolution: e.target.value })}>{settingsModel.resolutions.map((value) => <option key={value} value={value}>{imageResolutionLabel(form.imageModel, value)}</option>)}</select></label><label>视频模型<select value={form.videoModel} onChange={(e) => setForm({ ...form, videoModel: e.target.value })}><option value="doubao-seedance-2.0">doubao-seedance-2.0</option><option value="doubao-seedance-2.0-fast">doubao-seedance-2.0-fast 草稿</option></select></label></div></section><div className="button-row settings-actions"><button className="ghost" onClick={test}>测试 APIMart 连接</button><button className="primary" onClick={save}>保存设置</button></div>{message && <p className="notice wide">{message}</p>}</>;
}

function SettingsPageBase() {
  const [form, setForm] = useState({
    apiKey: "", volcengineAudioApiKey: "", imageModel: "gpt-image-2-official", imageResolution: "2k",
    videoModel: "doubao-seedance-2.0", audioModel: "seed-audio-1.0", defaultProvider: "mock" as "mock" | "apimart"
  });
  const [message, setMessage] = useState("");
  const [configured, setConfigured] = useState({ apimart: false, volcengine: false });
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState<"" | "apimart" | "volcengine_audio">("");
  const baselineRef = useRef("");
  const serialize = (value: typeof form) => JSON.stringify(value);
  const dirty = loaded && serialize(form) !== baselineRef.current;
  useEffect(() => {
    api.settings().then((value) => {
      const option = imageModelOption(value.imageModel);
      const next = {
        apiKey: "", volcengineAudioApiKey: "", imageModel: option.id,
        imageResolution: option.resolutions.includes(value.imageResolution as never) ? value.imageResolution : option.resolutions[0],
        videoModel: value.videoModel, audioModel: value.audioModel, defaultProvider: value.defaultProvider
      };
      setConfigured({ apimart: value.hasApiKey, volcengine: value.hasVolcengineAudioApiKey });
      setForm(next);
      baselineRef.current = serialize(next);
      setLoaded(true);
    }).catch((e: Error) => setMessage(e.message));
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const beforeLink = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest("a");
      if (!link || link.target === "_blank") return;
      if (!window.confirm("API 设置还有未保存修改，确定要离开吗？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeLink, true);
    };
  }, [dirty]);
  async function save() {
    try {
      await api.saveSettings(form);
      const next = { ...form, apiKey: "", volcengineAudioApiKey: "" };
      setConfigured((old) => ({ apimart: old.apimart || Boolean(form.apiKey), volcengine: old.volcengine || Boolean(form.volcengineAudioApiKey) }));
      setForm(next);
      baselineRef.current = serialize(next);
      setMessage("设置已安全保存。API Key 只保存在本机后端，并使用 Windows 当前用户加密。");
    } catch (e) { setMessage((e as Error).message); }
  }
  async function test(provider: "apimart" | "volcengine_audio") {
    setTesting(provider); setMessage("");
    try {
      const result = await api.testSettings(provider, provider === "apimart" ? form.apiKey || undefined : form.volcengineAudioApiKey || undefined);
      setMessage(result.message);
    } catch (e) { setMessage((e as Error).message); } finally { setTesting(""); }
  }
  const settingsModel = imageModelOption(form.imageModel);
  return <>
    <PageHeader eyebrow="GLOBAL SETTINGS" title="工作台全局 API 设置" description="这些配置适用于所有项目。真实 API Key 只保存在本机后端，浏览器和日志不会读取密钥明文。" actions={<span className={clsx("settings-dirty-state", dirty && "dirty")}>{dirty ? "有未保存修改" : loaded ? "所有修改已保存" : "正在读取设置"}</span>} />
    <section className="settings-connection-summary" aria-live="polite"><span className={configured.apimart ? "connected" : ""}>APIMart：{configured.apimart ? "已配置" : "未配置"}</span><span className={configured.volcengine ? "connected" : ""}>火山豆包：{configured.volcengine ? "已配置" : "未配置"}</span></section>
    <section className="settings-grid">
      <div className="panel"><h2>APIMart 图片 / 视频</h2><label>APIMart API Key<input type="password" autoComplete="new-password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={configured.apimart ? "已配置，留空表示不修改" : "粘贴 APIMart API Key"} /></label><label>默认运行模式<select value={form.defaultProvider} onChange={(e) => setForm({ ...form, defaultProvider: e.target.value as "mock" | "apimart" })}><option value="mock">Mock 免费模拟</option><option value="apimart">APIMart 真实生成</option></select></label><div className="security-note"><KeyRound /><p><b>检查配置不会产生费用</b>连接检查不会提交生图或视频任务。真实生成仍必须由你在项目内点击生成按钮。</p></div><button className="ghost" disabled={Boolean(testing)} onClick={() => test("apimart")}>{testing === "apimart" ? "正在检查…" : "检查 APIMart 配置"}</button></div>
      <div className="panel"><h2>火山豆包音频</h2><label>火山 API Key<input type="password" autoComplete="new-password" value={form.volcengineAudioApiKey} onChange={(e) => setForm({ ...form, volcengineAudioApiKey: e.target.value })} placeholder={configured.volcengine ? "已配置，留空表示不修改" : "粘贴火山引擎 API Key"} /></label><label>音频模型<select value={form.audioModel} onChange={(e) => setForm({ ...form, audioModel: e.target.value })}><option value="seed-audio-1.0">seed-audio-1.0</option></select></label><div className="security-note"><KeyRound /><p><b>检查配置不会产生费用</b>只有你在声音生产页点击生成时，工作台才会调用音频接口。</p></div><button className="ghost" disabled={Boolean(testing)} onClick={() => test("volcengine_audio")}>{testing === "volcengine_audio" ? "正在检查…" : "检查火山音频配置"}</button></div>
      <div className="panel"><h2>模型默认值</h2><label>生图模型<select value={form.imageModel} onChange={(e) => { const option = imageModelOption(e.target.value); setForm({ ...form, imageModel: e.target.value, imageResolution: option.resolutions[0] }); }}>{imageModelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label>{form.imageModel === "midjourney" ? "默认生成速度" : "默认图片分辨率"}<select value={form.imageResolution} onChange={(e) => setForm({ ...form, imageResolution: e.target.value })}>{settingsModel.resolutions.map((value) => <option key={value} value={value}>{imageResolutionLabel(form.imageModel, value)}</option>)}</select></label><label>视频模型<select value={form.videoModel} onChange={(e) => setForm({ ...form, videoModel: e.target.value })}><option value="doubao-seedance-2.0">doubao-seedance-2.0</option><option value="doubao-seedance-2.0-fast">doubao-seedance-2.0-fast 草稿</option></select></label></div>
    </section>
    <div className="button-row settings-actions"><button className="primary" disabled={!dirty} onClick={save}>{dirty ? "保存全局设置" : "设置已保存"}</button></div>
    {message && <p className="notice wide" aria-live="polite">{message}</p>}
  </>;
}

function AudioProductionPageWithLibrary({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  return <><AudioLibraryPreview data={data} reload={reload} /><AudioProductionPage data={data} reload={reload} /></>;
}

function AudioLibraryPreview({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const label = (type: string) => type === "dialogue_line" ? "成品台词" : type === "character_voice" ? "角色音色" : type === "scene_master" ? "场景对白母带" : type === "music" ? "音乐片段" : type === "ambience" ? "环境声" : "关键音效";
  const [removingId, setRemovingId] = useState("");
  const [message, setMessage] = useState("");
  async function removeAudioAsset(audio: DashboardData["audioAssets"][number]) {
    const warning = audio.type === "scene_master"
      ? `确认移除场景母带“${audio.name}”？它的本地文件和由它切出的片段也会一并移除，操作无法撤销。`
      : `确认移除声音资产“${audio.name}”？本地文件也会一并移除，操作无法撤销。`;
    if (!window.confirm(warning)) return;
    setRemovingId(audio.id); setMessage("");
    try {
      await api.deleteAudioAsset(audio.id);
      setMessage(`已移除“${audio.name}”。`);
      await reload();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setRemovingId("");
    }
  }
  return <section className="panel audio-library-preview"><div className="section-heading"><div><p className="eyebrow">AUDIO ASSETS</p><h2>已生成声音资产 · 试听</h2><p>母带、切片和角色音色都会保存在这里，先试听确认，再绑定到镜头。</p></div><span>{data.audioAssets.length} 项</span></div><div className="audio-preview-grid">{data.audioAssets.map((audio) => <article key={audio.id}><div className="audio-preview-heading"><div><strong>{audio.name}</strong><span>{label(audio.type)}</span></div><button className="danger" type="button" disabled={Boolean(removingId)} onClick={() => void removeAudioAsset(audio)}>{removingId === audio.id ? "正在移除…" : "移除"}</button></div>{audio.localPath ? <audio controls preload="metadata" src={`/api/audio-assets/${audio.id}/file`} /> : <small className="audio-preview-pending">音频文件尚未下载完成，请到任务中心查看进度</small>}<small>{audio.duration ? `${audio.duration.toFixed(1)} 秒` : "等待时长"} · {audio.remoteUrl ? "远程地址已配置" : "仅本地试听"}</small></article>)}{!data.audioAssets.length && <Empty text="还没有生成声音资产。先在下方声音生产区生成场景母带。" />}</div>{message && <p className="notice" aria-live="polite">{message}</p>}</section>;
}

function AudioProductionPage({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const navigate = useNavigate();
  type DialogueDraft = { id: string; sceneId: string; sceneNumber: number; sceneName: string; shotId: string | null; shotNumber: number; title: string; speaker: string; text: string; description: string; voiceDirection: string; sceneSound: string };
  const lines = useMemo<DialogueDraft[]>(() => extractLockedScriptDialogue(data.artifacts, data.shots).map((line) => ({
    ...line, shotNumber: line.shotNumber ?? line.sceneNumber, title: line.shotTitle || `分镜前 · ${line.sceneName}`
  })), [data.artifacts, data.shots]);
  const lockedScript = useMemo(() => latestLockedScript(data.artifacts), [data.artifacts]);
  const audioContext = useMemo(() => audioPromptContextFromScript(lockedScript?.content ?? ""), [lockedScript]);
  const audioStyle = audioContext.style;
  const [drafts, setDrafts] = useState<Record<string, DialogueDraft>>({});
  const [masterPrompt, setMasterPrompt] = useState("");
  const [masterName, setMasterName] = useState(() => `${data.project.name}·场景对白母带`);
  const [masterRefs, setMasterRefs] = useState("");
  const [selectedMasterId, setSelectedMasterId] = useState("");
  const [clipDrafts, setClipDrafts] = useState<Record<string, { startMs: number; endMs: number; handleMs: number; shotId: string | null; speaker: string; text: string }>>({});
  const [remoteDrafts, setRemoteDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  useEffect(() => { setDrafts((current) => Object.fromEntries(lines.map((line) => [line.id, current[line.id] ?? line]))); }, [lines]);
  useEffect(() => { if (!masterPrompt && lines.length) setMasterPrompt(buildAudioPrompt(lines, audioContext)); }, [audioContext, lines, masterPrompt]);
  useEffect(() => { setClipDrafts((current) => Object.fromEntries(data.audioClips.map((clip) => [clip.id, current[clip.id] ?? { startMs: clip.startMs, endMs: clip.endMs, handleMs: clip.handleMs, shotId: clip.shotId, speaker: clip.speaker, text: clip.text }]))); }, [data.audioClips]);
  const rows = lines.map((line) => drafts[line.id] ?? line);
  const masters = data.audioAssets.filter((asset) => asset.type === "scene_master");
  const selectedMaster = masters.find((asset) => asset.id === selectedMasterId) ?? masters.find((asset) => Boolean(asset.localPath)) ?? masters[0];
  const selectedMasterClipCount = selectedMaster ? data.audioClips.filter((clip) => clip.sourceAudioAssetId === selectedMaster.id).length : 0;
  const audioConfirmation = getAudioConfirmationProgress(rows, data.audioClips, data.shots);
  const confirmedLineCount = audioConfirmation.confirmed;
  const allAudioConfirmed = audioConfirmation.complete;
  const update = (id: string, patch: Partial<DialogueDraft>) => setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? lines.find((line) => line.id === id)!), ...patch } }));
  async function generateMaster() {
    if (busyId) return;
    if (data.project.dryRun) { setMessage("空跑测试项目只检查声音提示词，不会调用火山豆包音频API。"); return; }
    if (!masterName.trim() || !masterPrompt.trim()) { setMessage("请先填写场景母带名称和完整对白。"); return; }
    const promptErrors = validateAudioPrompt(masterPrompt, audioStyle);
    if (promptErrors.length) { setMessage(`提示词未通过检查：${promptErrors.join("；")}`); return; }
    setBusyId("master"); setMessage("");
    try {
      await api.generateAudioAsset(data.project.id, { type: "scene_master", name: masterName, textPrompt: masterPrompt, styleProfile: audioStyle, speaker: "", referenceAudioUrls: masterRefs.split(/[\n,]/).map((value) => value.trim()).filter(Boolean), format: "wav", sampleRate: 24000, enableSubtitle: true, speechRate: 0, pitchRate: 0, loudnessRate: 0, rightsNote: "本人拥有或已获授权使用该声音；仅用于本项目", description: "场景级对白母带；生成完成后先试听，再切成镜头片段并人工确认。", contentProducer: "猫掌柜AI漫剧工作台", contentPropagator: "猫掌柜工作室", aigcWatermark: true, enableWatermark: true });
      setMessage("场景对白母带任务已提交。生成完成后先试听，再进行自动切片。"); await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setBusyId(""); }
  }
  async function splitMaster() {
    if (busyId || !selectedMaster) { setMessage("请先选择一个已下载的场景母带。"); return; }
    if (!selectedMaster.localPath) { setMessage("该母带还没有本地试听文件，请等待任务完成。"); return; }
    const masterJob = data.jobs.find((job) => job.kind === "audio" && job.status === "completed" && String(job.params.audioAssetId ?? "") === selectedMaster.id);
    const automatic = buildAutomaticAudioSegments(rows, selectedMaster.duration, masterJob?.output);
    setBusyId("split"); setMessage("");
    try {
      await api.splitAudioAsset(data.project.id, selectedMaster.id, { segments: automatic.segments });
      setMessage(automatic.source === "subtitle"
        ? "已按豆包返回的逐句字幕时间精确切出镜头片段，请逐条试听并确认。"
        : "豆包没有返回完整字幕时间，当前只能按字数估算切片；请逐条试听并调整边界。");
      await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setBusyId(""); }
  }
  async function saveClip(clipId: string) { const draft = clipDrafts[clipId]; if (!draft) return; setBusyId(clipId); try { await api.updateAudioClip(clipId, draft); setMessage("音频片段已重新切片并保存。"); await reload(); } catch (e) { setMessage((e as Error).message); } finally { setBusyId(""); } }
  async function approveClip(clipId: string) { const clip = data.audioClips.find((item) => item.id === clipId); if (!clip) return; setBusyId(clipId); try { await api.approveAudioClip(clipId, clipDrafts[clipId]?.shotId ?? clip.shotId); setMessage("音频片段已确认，并绑定到对应镜头。"); await reload(); } catch (e) { setMessage((e as Error).message); } finally { setBusyId(""); } }
  async function saveRemote(audioId: string) { const asset = data.audioAssets.find((item) => item.id === audioId); if (!asset) return; try { await api.updateAudioAsset(audioId, { remoteUrl: remoteDrafts[audioId] ?? asset.remoteUrl, rightsNote: asset.rightsNote, description: asset.description }); setMessage("镜头音频片段的 HTTPS 地址已保存。"); await reload(); } catch (e) { setMessage((e as Error).message); } }
  if (!lockedScript || rows.length === 0) return <>
    <PageHeader eyebrow="AUDIO PRODUCTION" title="声音生产" description="声音母带直接读取最新锁定剧本，不再要求先有分镜。" />
    <section className="panel prerequisite-panel"><Volume2 size={28} /><div><h2>{lockedScript ? "当前剧本没有可识别对白" : "当前没有已锁定剧本"}</h2><p>{lockedScript ? "锁定剧本的结构化场景中没有识别到对白，因此暂时不能生成场景对白母带。" : "声音生产只能以用户已经通过的锁定剧本为依据，避免使用仍在修改的台词。"}</p></div><button className="primary" onClick={() => navigate(projectRoute(data.project.id, "script"))}>返回剧本审片</button></section>
  </>;
  if (audioStyle === "needs_review") return <>
    <PageHeader eyebrow="AUDIO PRODUCTION" title="声音生产" description="已从锁定剧本识别到对白，但声音风格信息还不完整。" />
    <section className="panel prerequisite-panel"><Volume2 size={28} /><div><h2>需要先补充声音风格</h2><p>请明确时代、地域、语言、口音和表演方式。缺少这些信息时，工作台不会提交真实音频任务。</p></div><button className="primary" onClick={() => navigate(projectRoute(data.project.id))}>返回创作档案</button></section>
  </>;
  return (
    <>
      <PageHeader
        eyebrow="AUDIO PRODUCTION"
        title="声音生产"
        description="先根据锁定剧本判定声音风格，再生成场景级对白母带；人工试听确认后，片段才会进入分镜视频参考。"
        actions={
          <div className="button-row">
            <button className="primary" disabled={data.project.dryRun || Boolean(busyId) || rows.length === 0} onClick={() => void generateMaster()}>
              <Sparkles size={17} />{data.project.dryRun ? "空跑项目不调用音频API" : "生成场景对白母带"}
            </button>
          </div>
        }
      />
      {data.project.dryRun && <p className="notice wide">当前只展示从锁定剧本提取的对白和已通过检查的声音提示词；不会创建真实音频任务。</p>}
      <section className="panel audio-production-intro">
        <strong>当前剧本已录入 {rows.length} 条台词</strong>
        <span>剧本判定声音风格：{audioStyleLabels[audioStyle]}。推荐流程：一次生成同一场景的完整对白 → 自动切片 → 人工试听 → 绑定镜头。</span>
      </section>
      <section className={clsx("panel audio-confirmation-summary", allAudioConfirmed && "complete")} aria-live="polite">
        <span className="audio-confirmation-check"><Check size={20} /></span>
        <div>
          <strong>{allAudioConfirmed ? "声音切片已全部确认并绑定" : "声音切片等待逐条试听确认"}</strong>
          <p>{allAudioConfirmed
            ? `${confirmedLineCount}/${rows.length} 条台词均已锁定到对应镜头，不需要再进行一次整体确认。`
            : `已确认并绑定 ${confirmedLineCount}/${rows.length} 条；请继续在下方逐条试听。`}</p>
        </div>
        <b>{confirmedLineCount}/{rows.length}</b>
      </section>
      <section className="panel audio-master-panel">
        <div className="section-heading">
          <div>
            <h2>场景对白母带</h2>
            <p>语言、口音、时代和表演方式由锁定剧本决定；技术接口配置已收进高级设置。</p>
          </div>
          <span>{masters.length} 条母带</span>
        </div>
        <label>母带名称<input value={masterName} onChange={(e) => setMasterName(e.target.value)} /></label>
        <label>
          完整对白与表演指令
          <textarea
            className="audio-master-prompt"
            value={masterPrompt}
            onChange={(e) => setMasterPrompt(e.target.value)}
            placeholder="先写角色声线清单，再写环境与音乐，最后按顺序写对白和音效。"
          />
        </label>
        <div className="audio-master-prompt-actions">
          <button className="ghost" type="button" disabled={Boolean(busyId) || rows.length === 0} onClick={() => setMasterPrompt(buildAudioPrompt(rows, audioContext))}>
            按已编辑台词重建官方模板
          </button>
          <span>结构固定为：角色声线 → 环境/音乐 → 按顺序对白与音效</span>
        </div>
        <details className="audio-advanced-settings">
          <summary>高级设置 · 角色音色参考</summary>
          <label>
            角色音色参考 HTTPS（每行一条，最多 3 条）
            <textarea value={masterRefs} onChange={(e) => setMasterRefs(e.target.value)} placeholder="建议每个主要角色一条 10～20 秒干净音色母版" />
          </label>
        </details>
        <div className="audio-master-actions">
          <select aria-label="选择已生成的场景母带" value={selectedMaster?.id ?? selectedMasterId} onChange={(e) => setSelectedMasterId(e.target.value)}>
            <option value="">选择已生成的场景母带</option>
            {masters.map((master) => <option key={master.id} value={master.id}>{master.name}{master.localPath ? " · 可切片" : " · 等待下载"}</option>)}
          </select>
          <button className="ghost" disabled={Boolean(busyId) || !selectedMaster?.localPath || selectedMasterClipCount > 0} onClick={() => void splitMaster()}>
            {selectedMasterClipCount > 0 ? `已切出 ${selectedMasterClipCount} 条片段` : "自动切成镜头片段"}
          </button>
        </div>
        {message && <p className="notice" aria-live="polite">{message}</p>}
      </section>
      <section className="audio-line-list">
        {rows.map((line) => {
          const clip = data.audioClips.find((item) => item.shotId === line.shotId && item.text === line.text)
            ?? data.audioClips.find((item) => item.text === line.text);
          const clipAsset = clip ? data.audioAssets.find((asset) => asset.id === clip.audioAssetId) : undefined;
          const draft = clip ? clipDrafts[clip.id] : undefined;
          return (
            <article className="panel audio-line-card" key={line.id}>
              <header>
                <div><span>镜头 {line.shotNumber} · {line.title}</span><h2>{line.speaker}</h2></div>
                {clip?.status === "approved"
                  ? <span className="audio-clip-approved-badge"><Check size={14} />已试听并绑定</span>
                  : <Status value={clip ? "processing" : "draft"} />}
              </header>
              <label>说话人<input value={line.speaker} onChange={(e) => update(line.id, { speaker: e.target.value })} /></label>
              <label className="audio-line-text">台词内容<textarea value={line.text} onChange={(e) => update(line.id, { text: e.target.value })} /></label>
              {clip && draft && clipAsset && (
                <div className="audio-clip-review">
                  <div>
                    <strong>镜头片段 · {clip.status === "approved" ? "已确认" : "待试听确认"}</strong>
                    <small>{draft.startMs}ms – {draft.endMs}ms · 前后保留 {draft.handleMs}ms</small>
                  </div>
                  <audio controls preload="metadata" src={`/api/audio-assets/${clipAsset.id}/file`} />
                  <div className="audio-line-footer">
                    <span>{clipAsset.remoteUrl ? "可以提交视频生成" : "暂不能提交视频生成"}</span>
                    <div className="button-row">
                      <button className="ghost" disabled={Boolean(busyId)} onClick={() => void saveClip(clip.id)}>重新切片</button>
                      {clip.status !== "approved" && <button className="primary" disabled={Boolean(busyId)} onClick={() => void approveClip(clip.id)}>试听通过并绑定镜头</button>}
                    </div>
                  </div>
                  <details className="audio-advanced-settings">
                    <summary>高级设置 · 切片边界与视频接口地址</summary>
                    <div className="audio-clip-fields">
                      <label>开始毫秒<input type="number" value={draft.startMs} onChange={(e) => setClipDrafts((current) => ({ ...current, [clip.id]: { ...draft, startMs: Number(e.target.value) } }))} /></label>
                      <label>结束毫秒<input type="number" value={draft.endMs} onChange={(e) => setClipDrafts((current) => ({ ...current, [clip.id]: { ...draft, endMs: Number(e.target.value) } }))} /></label>
                      <label>保留边界<input type="number" value={draft.handleMs} onChange={(e) => setClipDrafts((current) => ({ ...current, [clip.id]: { ...draft, handleMs: Number(e.target.value) } }))} /></label>
                    </div>
                    <label>
                      给视频接口的 HTTPS 音频地址
                      <input
                        value={remoteDrafts[clipAsset.id] ?? clipAsset.remoteUrl}
                        onChange={(e) => setRemoteDrafts((current) => ({ ...current, [clipAsset.id]: e.target.value }))}
                        placeholder="本地试听不等于 APIMart 可访问，请填写 HTTPS"
                      />
                    </label>
                    <button className="ghost" disabled={Boolean(busyId)} onClick={() => void saveRemote(clipAsset.id)}>保存高级设置</button>
                  </details>
                </div>
              )}
              {!clip && <p className="audio-clip-empty">母带切片后，这里会出现可试听的镜头音频片段。</p>}
            </article>
          );
        })}
      </section>
    </>
  );
}

function AudioProductionPageLegacy({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  type DialogueDraft = { id: string; shotId: string; shotNumber: number; title: string; speaker: string; text: string; speakerId: string; referenceAudioUrls: string; speechRate: number; pitchRate: number; loudnessRate: number; format: "wav" | "mp3" | "ogg_opus"; sampleRate: number; enableSubtitle: boolean; description: string; rightsNote: string };
  const lines = useMemo<DialogueDraft[]>(() => data.shots.filter((shot) => shot.dialogue.trim()).flatMap((shot) => shot.dialogue.split(/\n+/).map((raw, index) => {
    const match = raw.trim().match(/^([^：:]{1,24})[：:]\s*(.+)$/);
    return { id: `${shot.id}-${index}`, shotId: shot.id, shotNumber: shot.shotNumber, title: shot.title, speaker: match?.[1] ?? shot.speakerMap.split(/[：:；;]/)[0]?.trim() ?? "未指定角色", text: match?.[2] ?? raw.trim(), speakerId: "", referenceAudioUrls: "", speechRate: 0, pitchRate: 0, loudnessRate: 0, format: "wav", sampleRate: 24000, enableSubtitle: true, description: `镜头${shot.shotNumber}成品台词；用于稳定音色与口型时序。`, rightsNote: "本人拥有或已获授权使用该声音" };
  })), [data.shots]);
  const audioStyle = useMemo(() => {
    const latestScript = data.artifacts.filter((artifact) => artifact.type === "script").sort((a, b) => b.version - a.version)[0];
    return inferAudioStyleProfile(latestScript ? (typeof latestScript.content === "string" ? latestScript.content : JSON.stringify(latestScript.content)) : "");
  }, [data.artifacts]);
  const [drafts, setDrafts] = useState<Record<string, DialogueDraft>>({});
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  useEffect(() => { setDrafts((current) => Object.fromEntries(lines.map((line) => [line.id, current[line.id] ?? line]))); }, [lines]);
  const rows = lines.map((line) => drafts[line.id] ?? line);
  const isGenerated = (line: DialogueDraft) => data.audioAssets.some((asset) => asset.name === `镜头${line.shotNumber}·${line.speaker}台词`);
  const update = (id: string, patch: Partial<DialogueDraft>) => setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? lines.find((line) => line.id === id)!), ...patch } }));
  async function generateLine(line: DialogueDraft) {
    if (busyId) return;
    if (!line.text.trim() || !line.speaker.trim()) { setMessage("请先补充说话人和台词内容。"); return; }
    setBusyId(line.id); setMessage("");
    try {
      if (audioStyle === "needs_review") throw new Error("当前剧本没有明确声音风格，请先补充时代、地域、语言、口音和表演方式。");
      const textPrompt = buildAudioPrompt([{ speaker: line.speaker, text: line.text }], { style: audioStyle });
      const lintErrors = validateAudioPrompt(textPrompt, audioStyle);
      if (lintErrors.length) throw new Error(lintErrors.join("；"));
      await api.generateAudioAsset(data.project.id, { type: "dialogue_line", name: `镜头${line.shotNumber}·${line.speaker}台词`, characterAssetId: data.assets.find((asset) => asset.name === line.speaker)?.id ?? "", textPrompt, speaker: line.speakerId, referenceAudioUrls: line.referenceAudioUrls.split(/[\n,]/).map((value) => value.trim()).filter(Boolean), format: line.format, sampleRate: line.sampleRate, enableSubtitle: line.enableSubtitle, speechRate: line.speechRate, pitchRate: line.pitchRate, loudnessRate: line.loudnessRate, rightsNote: line.rightsNote, description: line.description, contentProducer: "猫掌柜AI漫剧工作台", contentPropagator: "猫掌柜工作室", aigcWatermark: true, enableWatermark: true });
      setMessage(`镜头${line.shotNumber}「${line.speaker}」音频任务已提交。`); await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setBusyId(""); }
  }
  async function generateAll() { for (const line of rows.filter((item) => !isGenerated(item))) await generateLine(line); }
  return <><PageHeader eyebrow="AUDIO PRODUCTION" title="声音生产" description="先把剧本所有台词整理成可编辑清单，再逐条确认音色、语速和字幕设置，最后由你点击生成。" actions={<div className="button-row"><button className="primary" disabled={Boolean(busyId) || rows.length === 0} onClick={() => void generateAll()}><Sparkles size={17} />生成全部待生成台词</button></div>} /><section className="panel audio-production-intro"><strong>当前剧本已录入 {rows.length} 条台词</strong><span>默认已预设：WAV、24kHz、字幕开启、语速/音调/音量为 0、AIGC 水印开启、权利说明已填写。人工可以逐条修改后再生成。</span></section><section className="audio-line-list">{rows.map((line) => { const pending = data.jobs.some((job) => job.kind === "audio" && job.prompt.includes(line.text) && ["draft", "submitted", "processing"].includes(job.status)); return <article className="panel audio-line-card" key={line.id}><header><div><span>镜头 {line.shotNumber} · {line.title}</span><h2>{line.speaker}</h2></div><Status value={pending ? "processing" : isGenerated(line) ? "completed" : "draft"} /></header><div className="audio-line-grid"><label>说话人<input value={line.speaker} onChange={(e) => update(line.id, { speaker: e.target.value })} /></label><label>豆包音色 ID<input value={line.speakerId} onChange={(e) => update(line.id, { speakerId: e.target.value })} placeholder="可留空，使用默认音色" /></label><label>输出格式<select value={line.format} onChange={(e) => update(line.id, { format: e.target.value as DialogueDraft["format"] })}><option value="wav">WAV</option><option value="mp3">MP3</option><option value="ogg_opus">OGG Opus</option></select></label><label>采样率<select value={line.sampleRate} onChange={(e) => update(line.id, { sampleRate: Number(e.target.value) })}><option value="24000">24 kHz</option><option value="44100">44.1 kHz</option><option value="48000">48 kHz</option></select></label></div><label className="audio-line-text">台词内容<textarea value={line.text} onChange={(e) => update(line.id, { text: e.target.value })} /></label><div className="audio-line-grid"><label>语速<input type="number" min={-50} max={100} value={line.speechRate} onChange={(e) => update(line.id, { speechRate: Number(e.target.value) })} /></label><label>音调<input type="number" min={-12} max={12} value={line.pitchRate} onChange={(e) => update(line.id, { pitchRate: Number(e.target.value) })} /></label><label>音量<input type="number" min={-50} max={100} value={line.loudnessRate} onChange={(e) => update(line.id, { loudnessRate: Number(e.target.value) })} /></label><label>参考音频 HTTPS<textarea value={line.referenceAudioUrls} onChange={(e) => update(line.id, { referenceAudioUrls: e.target.value })} placeholder="每行一个，最多3条" /></label></div><label className="audio-line-description">资产说明<textarea value={line.description} onChange={(e) => update(line.id, { description: e.target.value })} /></label><div className="audio-line-footer"><span>字幕：{line.enableSubtitle ? "开启" : "关闭"} · AIGC 水印：开启 · 权利说明已预设</span><button className="primary" disabled={Boolean(busyId) || pending} onClick={() => void generateLine(line)}><Sparkles size={16} />{busyId === line.id ? "正在提交…" : pending ? "任务处理中" : "生成这条台词"}</button></div></article>; })}{!rows.length && <Empty text="当前剧本还没有识别出台词，请先在剧本或分镜中填写对白。" />}</section></>;
}

function AudioGenerationPanel() {
  const { projectId = "" } = useParams();
  const [form, setForm] = useState({ name: "", type: "dialogue_line", characterAssetId: "", textPrompt: "", speaker: "", referenceAudioUrls: "", format: "wav", sampleRate: 24000, enableSubtitle: true, speechRate: 0, pitchRate: 0, loudnessRate: 0, rightsNote: "本人拥有或已获授权使用该声音", description: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function generate() {
    if (busy) return;
    if (!form.name.trim() || !form.textPrompt.trim()) { setMessage("请填写声音资产名称和音频提示词/台词。"); return; }
    setBusy(true); setMessage("");
    try { await api.generateAudioAsset(projectId, { ...form, referenceAudioUrls: form.referenceAudioUrls.split(/[,\n]/).map((item) => item.trim()).filter(Boolean) }); setMessage("音频任务已提交。生成完成后会自动下载并进入分镜台声音资产库；请在任务中心查看，不要重复点击。"); setForm((current) => ({ ...current, name: "", textPrompt: "", referenceAudioUrls: "" })); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel audio-generation-standalone"><div className="section-heading"><div><p className="eyebrow">DOUBAO AUDIO</p><h2>生成角色台词与声音资产</h2><p>只在你点击按钮后调用火山豆包音频接口。建议先生成每个角色的一条测试台词，确认音色后再批量生成。</p></div></div><div className="form-grid"><label>资产类型<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="dialogue_line">成品台词</option><option value="character_voice">角色音色</option><option value="ambience">环境声</option><option value="sfx">关键音效</option></select></label><label>资产名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：猫掌柜·镜头01台词" /></label><label>豆包音色 ID<input value={form.speaker} onChange={(e) => setForm({ ...form, speaker: e.target.value })} placeholder="声音复刻后的 speaker ID，可留空" /></label><label>输出格式<select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}><option value="wav">WAV</option><option value="mp3">MP3</option><option value="ogg_opus">OGG Opus</option></select></label></div><label>音频提示词 / 台词<textarea value={form.textPrompt} onChange={(e) => setForm({ ...form, textPrompt: e.target.value })} placeholder="猫掌柜用沉稳又嫌弃的普通话说：‘两位大哥，鞋可以带走，尊严要留下。’" /></label><div className="form-grid"><label>采样率<select value={form.sampleRate} onChange={(e) => setForm({ ...form, sampleRate: Number(e.target.value) })}><option value="24000">24 kHz</option><option value="44100">44.1 kHz</option><option value="48000">48 kHz</option></select></label><label>语速<input type="number" min="-50" max="100" value={form.speechRate} onChange={(e) => setForm({ ...form, speechRate: Number(e.target.value) })} /></label><label>音调<input type="number" min="-12" max="12" value={form.pitchRate} onChange={(e) => setForm({ ...form, pitchRate: Number(e.target.value) })} /></label><label>音量<input type="number" min="-50" max="100" value={form.loudnessRate} onChange={(e) => setForm({ ...form, loudnessRate: Number(e.target.value) })} /></label></div><label>参考音频 HTTPS 地址（可选，最多 3 条）<textarea value={form.referenceAudioUrls} onChange={(e) => setForm({ ...form, referenceAudioUrls: e.target.value })} placeholder="每行一条；每条不超过 30 秒、10 MB" /></label><label>权利说明<input value={form.rightsNote} onChange={(e) => setForm({ ...form, rightsNote: e.target.value })} /></label><div className="button-row"><button className="primary" disabled={busy || !projectId} onClick={generate}><Sparkles size={17} />{busy ? "正在提交…" : "生成这条音频"}</button></div>{message && <p className="notice">{message}</p>}</section>;
}

function SettingsPage() {
  const [params] = useSearchParams();
  const requestedReturn = params.get("from") ?? "";
  const returnPath = requestedReturn.startsWith("/project/") ? requestedReturn : "/";
  return <main className="global-settings-page"><header className="global-settings-topbar"><NavLink to="/" className="sidebar-brand"><div className="brand-mark small"><Clapperboard /></div><div><strong>猫掌柜</strong><span>工作台全局设置</span></div></NavLink><NavLink className="ghost" to={returnPath}>返回{returnPath === "/" ? "项目列表" : "原项目"}</NavLink></header><div className="global-settings-content"><SettingsPageBase /></div></main>;
}

export default App;
