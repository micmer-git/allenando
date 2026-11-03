/**
 * Il marchio. OROBIA: «oro» come il giallo, le Orobie come le montagne di Bergamo, e il suono
 * di un mondo da pedalare. L'indirizzo (/allenando/), il repo e il database locale restano
 * «allenando»: cambiarli farebbe perdere i giri salvati e le app già installate.
 */
export const BRAND = {
  name: 'OROBIA',
  /** come si scrive in una frase */
  title: 'Orobia',
  claim: 'Le strade vere di Bergamo, sul rullo.',
  yellow: '#ffc814',
  amber: '#ff9f1c',
  ink: '#16130a',
  night: '#0c0b09',
} as const;

/**
 * Il simbolo, su una griglia di 64 (la stessa di public/favicon.svg e delle icone PWA): un
 * medaglione d'oro di raggio 24, la cresta delle Orobie che lo taglia (due cime, la sella in
 * mezzo) e la strada che sale a tornanti fino al passo.
 */
export const MARK = {
  disc: { cx: 32, cy: 32, r: 24 },
  ridge: 'M4 42 20.5 26.5l6.5 6.8L38.5 19 60 42v22H4Z',
  road: 'M34.5 58 23.5 52.2 37 46.6 25.6 41.2l2.2-6.2',
} as const;
