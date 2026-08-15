import { DemoControls } from '../../components/DemoControls';
import { RecentLogsPanel } from '../../components/RecentLogsPanel';
import { StatsStrip } from '../../components/StatsStrip';

// O PAINEL — o que o operador olha.
//
// Sem cards de produto: comprar e coisa da loja, em `/`. Aqui ficam as metricas,
// as ultimas linhas de log e os controles de palco.
export const dynamic = 'force-dynamic';

export default function Dashboard() {
  return (
    <>
      <StatsStrip />
      <RecentLogsPanel />
      <DemoControls />
    </>
  );
}
