// Content of the French Tech Visa guide (/french-tech-visa): an English adaptation of La French
// Tech's official page on the visa, completed with the Business France "Welcome to France" pages it
// links to. Figures were checked against those sources on the date below; the rules belong to the
// French administration and change, so every section links its official source. The content lives
// here in code on purpose (no admin editor), like the two Thailand guides.
import type { ChecklistPhase, Source } from './thailand-guides';

export const VISA_CHECKED_ON = '2026-11-03';

/** VISA_CHECKED_ON as shown on the page: "3 November 2026". */
export const VISA_CHECKED_LABEL = new Date(`${VISA_CHECKED_ON}T00:00:00Z`).toLocaleDateString(
  'en-GB',
  { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' },
);

const src = (label: string, url: string): Source => ({ label, url });
const WELCOME =
  'https://welcome.businessfrance.fr/simplanter-en-france/recruter-des-talents-internationaux/visas-et-titres-de-sejour';

export const VISA_SOURCES = {
  frenchTech: src(
    'French Tech Visa (La French Tech, official page)',
    'https://lafrenchtech.gouv.fr/fr/venir-travailler-en-france/french-tech-visa/',
  ),
  employees: src(
    'French Tech Visa for Employees (Business France, Welcome to France)',
    `${WELCOME}/recrutement-salaries-etrangers/french-tech-visa-for-employees/`,
  ),
  founders: src(
    'French Tech Visa for Founders (Business France, Welcome to France)',
    `${WELCOME}/les-statuts-des-dirigeants-etrangers/french-tech-visa-for-founders/`,
  ),
  investors: src(
    'French Tech Visa for Investors (Business France, Welcome to France)',
    `${WELCOME}/les-statuts-des-dirigeants-etrangers/french-tech-visa-for-investors/`,
  ),
  attestation: src(
    'Innovative company attestation (Démarches simplifiées)',
    'https://www.demarches-simplifiees.fr/commencer/passeport-talent-entreprise-innovante',
  ),
  publicSupport: src(
    'List of qualifying public innovation support (Légifrance)',
    'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053981245',
  ),
  family: src('Accompanying family (Business France)', `${WELCOME}/famille-accompagnante/`),
  franceVisas: src('France-Visas, official visa website', 'https://france-visas.gouv.fr/'),
  anef: src(
    'Validate your VLS-TS or apply for a residence permit (ANEF)',
    'https://administration-etrangers-en-france.interieur.gouv.fr/particuliers/#/vls-ts/demarches/etape/numero-visa',
  ),
  algeria: src(
    'Algerian nationals: residence certificate (Business France)',
    `${WELCOME}/recrutement-salaries-etrangers/certificat-de-residence-profession-salariee/`,
  ),
} as const;
export type VisaSourceKey = keyof typeof VISA_SOURCES;

/** The headline facts, shown as four figures under the hero. */
export const KEY_FACTS: { value: string; label: string }[] = [
  { value: '4 years', label: 'Multi-year "Talent" residence permit, renewable' },
  { value: '3 tracks', label: 'Employees, founders and investors' },
  { value: '1,200+', label: 'Companies have hired through it, according to La French Tech' },
  { value: 'Since 2017', label: 'Run by Business France with the Mission French Tech' },
];

export const BENEFITS: { title: string; text: string }[] = [
  {
    title: 'Up to four years',
    text: 'A multi-year "Talent" residence permit (formerly "Passeport Talent") valid for up to 4 years, depending on your situation.',
  },
  {
    title: 'No separate work permit',
    text: 'For employees, the Talent permit is also the work authorisation for its whole validity.',
  },
  {
    title: 'Your family comes too',
    text: 'Your spouse and dependent children under 18 can join you. Your spouse gets a "Talent – Famille" permit and can take any job in France.',
  },
  {
    title: 'Renewable',
    text: 'Renewed on the same conditions while your situation stays the same. If it changes, you can apply for another Talent permit or another kind of residence permit.',
  },
];

export interface Track {
  id: 'employees' | 'founders' | 'investors';
  label: string;
  /** French name of the residence status, as written on the permit. */
  status: string;
  who: string;
  conditions: string[];
  note?: string;
  sources: VisaSourceKey[];
}

export const TRACKS: Track[] = [
  {
    id: 'employees',
    label: 'Employees',
    status: 'Talent – Salarié qualifié (salarié d’une entreprise innovante)',
    who: 'You have a job offer from a French startup recognised as innovative, and you want to work in France for more than three months.',
    conditions: [
      'A permanent contract (CDI) or a fixed-term contract (CDD) of at least 3 months with an employer established in France.',
      'A gross annual salary of at least €39,582 (the reference figure in force since 31 August 2025).',
      'A job directly linked to the company’s R&D project or to its economic, social, international or environmental development.',
      'An employer that holds the innovative company attestation (see “Is the company innovative?” below).',
    ],
    note: 'Already in France with a Talent permit? You can move to another innovative company without a new procedure, as long as the new job meets the same conditions.',
    sources: ['employees', 'attestation'],
  },
  {
    id: 'founders',
    label: 'Founders',
    status: 'Talent – Porteur de projet économique innovant',
    who: 'You are founding a startup and want to build an innovative project in France.',
    conditions: [
      'A real, innovative economic project to develop in France.',
      'The innovative character of the project recognised by a public body (the regional labour and economy directorate, DRIEETS).',
      'Enough money to live on: at least the French minimum wage (SMIC), €22,404.20 a year as of 1 June 2026.',
    ],
    note: 'Citizens of the EU, the EEA and Switzerland can create and run a company in France without any residence procedure.',
    sources: ['founders', 'frenchTech'],
  },
  {
    id: 'investors',
    label: 'Investors',
    status: 'Talent – Investisseur économique',
    who: 'You are a foreign executive making a direct investment in France, personally, through a company you run, or through a company in which you hold at least 30% of the capital.',
    conditions: [
      'Invest, or commit to invest, at least €300,000 in tangible or intangible fixed assets in France.',
      'Create or keep jobs in France, or commit to do so, within 4 years of the investment.',
      'Direct investment only: share capital, reinvested profits or loans between related companies. Purely financial investments do not qualify.',
    ],
    note: 'The permit covers running the investment project and the business directly linked to it.',
    sources: ['investors', 'frenchTech'],
  },
];

/** The three criteria; an employer needs at least one of them (and a French SIRET number). */
export const CRITERIA: { title: string; text: string; source?: VisaSourceKey }[] = [
  {
    title: 'Public innovation support',
    text: 'The company received public support for innovation in the last 5 years, from the official list of qualifying schemes.',
    source: 'publicSupport',
  },
  {
    title: 'An innovation investor',
    text: 'All or part of its capital is held by an investment entity whose main purpose is to finance or invest in innovative companies.',
  },
  {
    title: 'An innovation programme',
    text: 'In the last 5 years it was supported by a structure dedicated to innovative companies, such as an incubator or accelerator.',
  },
];

/** How it goes from Thailand, in order. */
export const STEPS: { title: string; text: string; sources: VisaSourceKey[] }[] = [
  {
    title: 'Check your track',
    text: 'Employee, founder or investor: each has its own conditions and its own Business France page. Citizens of Algeria fall under the Franco-Algerian agreement instead.',
    sources: ['employees', 'founders', 'investors'],
  },
  {
    title: 'Get the company or project recognised',
    text: 'Employees: your future employer requests the innovative company attestation online. It is valid 3 years and renewable, and goes into your visa file. Founders: your project needs its official recognition.',
    sources: ['attestation'],
  },
  {
    title: 'Apply for the long-stay visa',
    text: 'Create your application on France-Visas, the official website, choosing the “Talent” long-stay visa, then book an appointment to hand in your file and biometrics at the visa centre it names in Thailand.',
    sources: ['franceVisas'],
  },
  {
    title: 'Arrive and validate',
    text: 'A stay under a year can be covered by a “VLS-TS Talent” visa, valid up to 12 months, which lets you work from day one. You must validate it online after arrival.',
    sources: ['anef'],
  },
  {
    title: 'Get your multi-year permit',
    text: 'Then apply online for the multi-year Talent residence permit of up to 4 years, renewable while you still meet the conditions.',
    sources: ['anef', 'employees'],
  },
];

export const CHECKLIST: ChecklistPhase[] = [
  {
    title: 'Everyone',
    items: [
      'Passport valid for the whole stay',
      'Not an EU, EEA or Swiss citizen (they need no visa), nor Algerian (separate agreement)',
      'Long-stay “Talent” visa application started on France-Visas',
      'Appointment booked at the visa centre in Thailand',
      'Spouse and children’s applications prepared, if they come with you',
    ],
  },
  {
    title: 'Employees',
    items: [
      'Signed contract (CDI, or CDD of 3 months or more)',
      'Gross annual salary of €39,582 or more',
      'Innovative company attestation from your employer',
      'Job linked to the company’s R&D or development',
    ],
  },
  {
    title: 'Founders',
    items: [
      'Innovative project to develop in France',
      'Official recognition of the project',
      'Proof of resources of at least the SMIC (€22,404.20 a year)',
    ],
  },
  {
    title: 'Investors',
    items: [
      'Plan to invest €300,000 or more in fixed assets in France',
      'Direct investment, personally or through a company you run or hold 30% of',
      'Jobs created or kept within 4 years',
    ],
  },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Can Thai citizens apply?',
    a: 'Yes. The French Tech Visa is open to nationals of every country outside the EU, the EEA and Switzerland, Algeria excepted, so Thai citizens and people of other nationalities living in Thailand can apply.',
  },
  {
    q: 'Is the French Tech Visa a separate visa?',
    a: 'No. It is a simplified, faster route to the multi-year “Talent” residence permit (formerly “Passeport Talent”) for people joining, founding or investing in French tech companies.',
  },
  {
    q: 'Does the company need to meet all three innovation criteria?',
    a: 'No. A company registered in France with a SIRET number needs at least one of the three, and the attestation that proves it, valid for 3 years.',
  },
  {
    q: 'Do I need a separate work permit?',
    a: 'No. For employees, the Talent residence permit is also the work authorisation for its whole validity.',
  },
  {
    q: 'Can my spouse work in France?',
    a: 'Yes. Your spouse can get a “Talent – Famille” permit, which allows any salaried job for as long as your own permit is valid. Dependent children under 18 can come too.',
  },
  {
    q: 'What if I change jobs?',
    a: 'You can join another company without a new procedure if that company is also recognised as innovative and the new job meets the same conditions. Otherwise, you can apply for another residence permit.',
  },
  {
    q: 'How much does it cost and how long does it take?',
    a: 'Visa and permit fees and processing times are set by the French administration and change. Check them on France-Visas and the Business France page for your track before you apply.',
  },
];

/** Listed under "Sources" at the end of the page, in this order. */
export const ALL_SOURCES: Source[] = Object.values(VISA_SOURCES);
