export const riskColors:Record<string,string>={Low:'#43a267',Medium:'#e6a625',Moderate:'#e6a625',High:'#d95050',Critical:'#8f1d2c'};
export function assessedZoneFill(zone:Record<string,unknown>) {
  const color=riskColors[String(zone['assessed_risk_level']??'')];
  return {fillColor:color??'transparent',fillOpacity:color&&Number(zone['active_report_count'])>0?.24:0};
}
