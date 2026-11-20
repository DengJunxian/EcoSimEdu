type Seat = { id: string; status: string; used: number; capacity: number | string };

export function SchoolSeats({ schools, active, select }: {
  schools: readonly Seat[]; active: string; select: (school: string) => void;
}) {
  return <div className="matching-seats" role="group" aria-label="三所学校席位">
    {schools.map(({ id, status, used, capacity }) => <button type="button" key={id} aria-pressed={id === active}
      onClick={() => select(id)}>
      <strong>{id} 校</strong><span>{status} {used} / {capacity}</span>
    </button>)}
  </div>;
}

export function QualityBreakdown({ distribution }: { distribution: Readonly<Record<string, number>> }) {
  const limit = Math.max(...Object.values(distribution), 1);
  return <ul className="lemon-quality">
    {Object.entries(distribution).map(([quality, count]) => <li key={quality} aria-label={`质量 ${quality}，${count} 件`}>
      <span>质量 {quality}</span><meter min={0} max={limit} value={count}
        aria-label={`质量 ${quality} 的挂牌数量`}/><strong>{count}</strong>
    </li>)}
  </ul>;
}

type Action = { id: string; actor: string; choice?: string; status?: string; signal?: string; observed?: boolean; active: boolean };

export function SignalChain({ actions, choose, disabled = false, label = "行动序列" }: {
  actions: readonly Action[]; choose: (action: Action) => void; disabled?: boolean; label?: string;
}) {
  return <ol className="cooperation-chain" aria-label={label}>
    {actions.map(action => <li key={action.id}><button type="button" aria-pressed={action.active} disabled={disabled}
      aria-label={[action.actor, action.choice ? `选择 ${action.choice}` : action.status,
        action.signal && `抽样 ${action.signal}`, action.observed && "当前参与者已观察"].filter(Boolean).join(" · ")}
      data-observed={action.observed || undefined} onClick={() => choose(action)}>
      <span>{action.actor}</span>
      {action.choice ? <strong>选择 {action.choice}</strong> : <span>{action.status}</span>}
      {action.signal && <small>抽样 {action.signal}</small>}
    </button></li>)}
  </ol>;
}
