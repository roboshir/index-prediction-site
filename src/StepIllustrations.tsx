const examples = [
  { code: "7203", name: "トヨタ自動車", color: "#87b945", weight: 30 },
  { code: "6758", name: "ソニーグループ", color: "#6baec4", weight: 25 },
  { code: "6501", name: "日立製作所", color: "#efbf57", weight: 20 },
  { code: "9984", name: "ソフトバンクG", color: "#b49acc", weight: 15 },
  { code: "8306", name: "三菱UFJ", color: "#dc9d89", weight: 10 },
];

export function StockSelectionIllustration() {
  return <svg className="step-illustration" viewBox="0 0 280 135" role="img" aria-label="銘柄選択の例：トヨタ自動車、ソニーグループ、日立製作所、ソフトバンクグループ、三菱UFJ">
    <rect x="22" y="3" width="236" height="126" rx="12" fill="#f5f8f0"/>
    {examples.map((stock, i) => <g key={stock.code} transform={`translate(32 ${9+i*23})`}>
      <rect width="216" height="20" rx="6" fill="white" stroke="#e0e8d8"/>
      <circle cx="11" cy="10" r="6" fill={stock.color}/>
      <path d="m8 10 2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <text x="25" y="14" fill="#6c785f" fontSize="9" fontFamily="sans-serif">{stock.code}</text>
      <text x="61" y="14" fill="#374132" fontSize="10" fontFamily="sans-serif">{stock.name}</text>
      <path d="m180 13 6-4 5 2 8-6" stroke={stock.color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </g>)}
  </svg>;
}

export function WeightIllustration() {
  let offset = 0;
  const radius = 40;
  const circumference = 2*Math.PI*radius;
  return <svg className="step-illustration" viewBox="0 0 280 135" role="img" aria-label="構成比率の例：30%、25%、20%、15%、10%、合計100%">
    <circle cx="72" cy="67" r="55" fill="#f5f8f0"/>
    {examples.map(stock => {
      const start=offset; offset+=stock.weight;
      return <circle key={stock.code} cx="72" cy="67" r={radius} fill="none" stroke={stock.color} strokeWidth="19" strokeDasharray={`${stock.weight/100*circumference} ${circumference}`} strokeDashoffset={-start/100*circumference} transform="rotate(-90 72 67)"/>;
    })}
    <text x="72" y="65" textAnchor="middle" fill="#6c785f" fontSize="10" fontFamily="sans-serif">合計</text>
    <text x="72" y="82" textAnchor="middle" fill="#374132" fontSize="18" fontWeight="700" fontFamily="sans-serif">100%</text>
    {examples.map((stock,i)=><g key={stock.code} transform={`translate(145 ${17+i*22})`}>
      <circle cx="4" cy="5" r="4" fill={stock.color}/>
      <rect x="17" y="2" width="70" height="6" rx="3" fill="#edf1e8"/>
      <rect x="17" y="2" width={stock.weight*2} height="6" rx="3" fill={stock.color}/>
      <circle cx={17+stock.weight*2} cy="5" r="4" fill="white" stroke={stock.color} strokeWidth="2"/>
      <text x="98" y="9" fill="#374132" fontSize="11" fontWeight="700" fontFamily="sans-serif">{stock.weight}%</text>
    </g>)}
  </svg>;
}
