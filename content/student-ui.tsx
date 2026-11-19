import type { ReactNode, Ref } from "react";

export function AppShell({ header, skipClass, children }: {
  header: ReactNode; skipClass: string; children?: ReactNode;
}) {
  return <>
    <a className={skipClass} href="#main" onClick={event => {
      const main = document.getElementById("main");
      if (!main) return;
      event.preventDefault();
      main.focus();
      main.scrollIntoView({ block: "nearest" });
    }}>跳到主要内容</a>
    {header}
    {children}
  </>;
}

export function Navigation({ children, className }: { children: ReactNode; className?: string }) {
  return <nav aria-label="主导航" className={className}>{children}</nav>;
}

export function PageTitle({ children, description, headingRef }: {
  children: ReactNode; description?: ReactNode; headingRef?: Ref<HTMLHeadingElement>;
}) {
  return <div className="edu-title">
    <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{children}</h1>
    {description && <p>{description}</p>}
  </div>;
}

export function Breadcrumb({ links, current }: { links: readonly { href: string; label: string }[]; current: string }) {
  return <nav className="edu-breadcrumb" aria-label="当前位置"><ol>
    {links.map(({ href, label }) => <li key={href}><a href={href}>{label}</a></li>)}
    <li aria-current="page">{current}</li>
  </ol></nav>;
}

export function CaseCard({ title, label, id, level: Heading = "h3", className, children }: {
  title: string; label?: string; id?: string; level?: "h2" | "h3" | "h4"; className?: string; children: ReactNode;
}) {
  return <article className={`edu-case-card ${className ?? ""}`} id={id} aria-label={label ?? title}>
    <Heading className="edu-case-title">{title}</Heading>
    {children}
  </article>;
}

export function ProgressStepper({ steps, current }: { steps: readonly string[]; current: number }) {
  return <nav aria-label="课堂进度"><ol className="stepper">
    {steps.map((label, index) => <li key={label} aria-current={index === current - 1 ? "step" : undefined}
      data-completed={index < current - 1}><span className="step-number">{index + 1}</span>{label}</li>)}
  </ol></nav>;
}

export function StatusNotice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" | "warning" }) {
  return <div className="edu-status" data-tone={tone} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

export function ActionPanel({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <section className={`edu-panel edu-action ${className ?? ""}`} aria-label={label}>{children}</section>;
}

export function EvidenceCard({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <section className={`edu-panel edu-evidence ${className ?? ""}`} aria-label={label}>{children}</section>;
}

export function MetricCard({ label, value }: { label: string; value: string | number }) {
  return <div className="edu-metric"><h2>{label}</h2><output aria-label={label} aria-live="off">{value}</output></div>;
}

export function InspectorPanel({ children }: { children: ReactNode }) {
  return <aside className="inspector" aria-label="个体决策透视">{children}</aside>;
}
