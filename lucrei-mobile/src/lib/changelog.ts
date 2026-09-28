export type ChangelogEntry = {
  // Data no formato YYYY-MM-DD - dobra de id (comparável como string) e de
  // texto exibido, não existe um número de versão formal do app pra usar aqui.
  version: string;
  items: string[];
};

// Mais recente primeiro. Adicionar uma entrada nova aqui é o único passo
// necessário pra ela aparecer no modal de novidades - ver whats-new-modal.tsx.
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2026-09-28',
    items: [
      'Corrigido: fazer upgrade de plano não cancela mais seu plano atual se você desistir do pagamento.',
      'Novo: cupons de desconto na tela de Planos.',
      'Novo: toque no "?" de cada número da tela inicial pra ver como ele é calculado.',
    ],
  },
];
