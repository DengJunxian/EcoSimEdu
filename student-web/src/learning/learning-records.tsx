import { useState, type FormEvent } from "react";
import { downloadJson } from "../contracts";
import { clearLearning, exportLearning, restoreLearning } from "./learning-archive";
import { profileId } from "./learner-repository";

export function LearningRecords() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function perform(action: (profile: string) => Promise<void>) {
    setBusy(true);
    setError("");
    setStatus("");
    try { await action(await profileId(false)); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "浏览器学习存储不可用。"); }
    finally { setBusy(false); }
  }

  function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("learning");
    void perform(async profile => {
      if (!(file instanceof File) || !file.size || file.size > 5_000_000) throw new Error("请选择小于 5 MB 的学习记录文件。");
      const { restored, restoredRecords, preservedVersions } = await restoreLearning(profile, JSON.parse(await file.text()));
      setStatus(preservedVersions ? `已恢复 ${restored} 次当前作答，另保留 ${preservedVersions} 次待核对的旧版作答。` :
        restored ? `已恢复 ${restored} 次作答。` : restoredRecords ? "已恢复本地学习资料。" : "这些作答已在本机。");
    });
  }

  return <details className="app-empty">
    <summary>备份此浏览器的作答记录</summary>
    <p>备份包含作答、活动、复习、解释卡和实验卡。原版笔记可以单独导出，运行引用依赖原 SQLite 运行库。</p>
    <button type="button" disabled={busy} onClick={() => void perform(async profile => {
      const data = await exportLearning(profile);
      downloadJson("ecosimedu-作答记录.json", data);
      setStatus(`已导出 ${data.attempts.length} 次作答。`);
    })}>导出作答记录</button>
    <form onSubmit={restore}>
      <label>作答记录文件 <input type="file" name="learning" accept=".json,application/json" required disabled={busy}/></label>
      <button disabled={busy}>恢复作答记录</button>
    </form>
    <button type="button" disabled={busy} onClick={() => {
      if (window.confirm("清除此浏览器个人作答与复习？建议先导出备份。实验笔记、解释卡、运行和提示暴露记录会保留。")) {
        void perform(async profile => { await clearLearning(profile); setStatus("已清除个人作答与复习。"); });
      }
    }}>清除个人作答与复习</button>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </details>;
}
