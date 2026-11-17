import type { ReactNode } from "react";

const shapes: Record<string, ReactNode> = {
  double_auction: <><path d="M9 10h19v11h16v12h18v12h25M9 54h19V43h16V33h18V22h25" /><circle cx="51" cy="33" r="5"/></>,
  schelling_segregation: <><path d="M14 9h63v45H14zM35 9v45M56 9v45M14 24h63M14 39h63"/><circle cx="24" cy="16" r="4"/><circle cx="45" cy="31" r="4"/><rect x="61" y="27" width="10" height="10"/><rect x="40" y="43" width="10" height="8"/></>,
  svb_run: <><path d="M36 28h24v23H36zM32 28l16-12 16 12M43 33v12m10-12v12M16 14l16 12m48-12L64 26M16 53l16-11m48 11L64 42"/><circle cx="12" cy="10" r="4"/><circle cx="84" cy="10" r="4"/><circle cx="12" cy="55" r="4"/><circle cx="84" cy="55" r="4"/></>,
  information_cascade: <><path d="M12 43h72M17 17v15m21-15v15m21-15v15m21-15v15" strokeDasharray="3 3"/>{[17, 38, 59, 80].map(x => <circle key={x} cx={x} cy="43" r="6"/>)}<path d="M15 12h4m17 0h4m17 0h4m17 0h4"/></>,
  public_goods: <><path d="M15 12l22 17m44-17L59 29M15 53l22-17m44 17L59 36"/><circle cx="15" cy="12" r="5"/><circle cx="81" cy="12" r="5"/><circle cx="15" cy="53" r="5"/><circle cx="81" cy="53" r="5"/><circle cx="48" cy="32" r="11"/></>,
  commons_governance: <><ellipse cx="48" cy="34" rx="33" ry="21"/><path d="M18 41c12-10 19 7 30 0s21-4 29 0M42 27l7 3 7-3m-7 3v6"/></>,
  lemons_market: <><rect x="15" y="13" width="26" height="34" rx="3"/><rect x="55" y="13" width="26" height="34" rx="3"/><path d="M22 38h12m28 0h12M23 28l4 4 7-9m28 1 11 9m0-9-11 9"/></>,
  school_matching: <><path d="M20 12h8v8h-8zM20 29h8v8h-8zM20 46h8v8h-8zM31 17l35 28M31 33l35-14m-35 31 35-5"/><circle cx="72" cy="19" r="7"/><circle cx="72" cy="45" r="7"/></>,
  beer_game: <><path d="M8 22h18v19H8zM39 22h18v19H39zM70 22h18v19H70zM26 32h13m18 0h13M17 48v6h62v-6M79 15V9H17v6"/></>,
  carbon_market: <><path d="M11 48h75M17 40h13v8H17zM40 31h13v17H40zM63 17h13v31H63zM12 24c17-12 36-16 53-15m-4-4 5 4-5 3"/></>,
  flash_crash: <><path d="M11 53h75M14 21l14 1 10-8 12 32 14-15 20-5"/><path d="M50 8v41" strokeDasharray="3 4"/><circle cx="50" cy="46" r="4"/></>,
  gamestop: <><path d="M12 44l13-6 15 3 12-11 12 3 17-19M73 14h8v8"/><path d="M16 23h14m-14-8h22M18 55h62"/></>,
};

export function Mechanism({ caseId }: { caseId: string }) {
  return <svg className="app-mechanism" viewBox="0 0 96 64" aria-hidden="true" focusable="false">
    <g>{shapes[caseId]}</g>
  </svg>;
}

export function QuoteDiagram() {
  return <figure className="app-quote">
    <svg viewBox="0 0 470 227" role="img" aria-label="买方与卖方提交限价。两张报价相交后，订单进入撮合。">
      <path className="app-quote-axis" d="M39 50h392M39 96h392M39 142h392M39 188h392"/>
      <path className="app-quote-bid" d="M39 148h70v-24h59V99h67V65h84"/>
      <path className="app-quote-ask" d="M151 54h41v28h43v17h69v23h55v27h72"/>
      <circle cx="235" cy="99" r="13" className="app-quote-halo"/>
      <circle cx="235" cy="99" r="5" className="app-quote-fill"/>
      <text x="39" y="182">买方限价</text>
      <text x="431" y="182" textAnchor="end">卖方要价</text>
      <text x="235" y="132" textAnchor="middle">撮合</text>
    </svg>
    <figcaption>双向拍卖机制示意</figcaption>
  </figure>;
}
