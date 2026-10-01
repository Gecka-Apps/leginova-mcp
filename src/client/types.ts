// SPDX-License-Identifier: AGPL-3.0-or-later

// Shapes of the Leginova `/api` responses, limited to the fields this server reads.
// The backend is generated from an OpenAPI spec that is not published; every
// field is optional here because the API omits or nulls them freely.

export interface Labelled {
  id?: string;
  libelle?: string;
  instanceLabel?: string;
}

export interface NatureActe extends Labelled {
  feminin?: boolean;
}

export interface SearchHit {
  type?: Labelled & { ordreTri?: number };
  rubrique?: Labelled;
  erratum?: boolean;
  phraseMatch?: boolean;
  headlineContenu?: string;
  listTheme?: string[];
  collectiviteLibelle?: string;

  // TEXTE_CONSOLIDE
  texteConsolideId?: number;
  natureActe?: NatureActe;
  numeroTexteConsolide?: string;
  objetTexteConsolide?: string;
  headlineObjetTexteConsolide?: string;
  dateTexteConsolide?: string;
  dateConsolidationTexteConsolide?: string;

  // CODE, SECTION_CODE, ARTICLE_CODE
  nomCode?: string;
  slugCode?: string;
  slugSection?: string;
  slugArticle?: string;
  nomPartieCode?: string;
  headlineTitre?: string;
  headlineNumero?: string;
  codeDateApplication?: string;

  // JURISPRUDENCE
  jurisprudenceId?: number;
  slugJurisprudence?: string;
  numeroReference?: string;
  headlineNumeroReference?: string;
  juridiction?: Labelled;
  ordre?: Labelled;
  typeJurisprudence?: Labelled;
  dateAudiencePublique?: string;

  // JONC_ACTE
  acteId?: number;
  numeroActe?: string;
  headlineNumeroActe?: string;
  headlineObjet?: string;
  dateActe?: string;
  joncNumero?: string;
  headlineJoncNumero?: string;
  joncDatePublication?: string;

  // DEBAT
  debatId?: number;
  mandature?: number;
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
  parentValue?: string;
}

export interface FacetGroup {
  code: string;
  label: string;
  listValue: FacetValue[];
}

export interface SearchResponse {
  query?: string;
  page?: number;
  size?: number;
  totalCount?: number | null;
  appliedFilters?: Record<string, string>;
  listResultat?: SearchHit[];
  listMeilleureCorrespondance?: SearchHit[];
  natureMeilleureCorrespondance?: string | null;
  listFacetGroup?: FacetGroup[];
}

export interface Suggestion {
  type?: Labelled;
  id?: number;
  slug?: string;
  titre?: string;
}

export interface CodeSummary {
  id: number;
  libelle: string;
  slug: string;
}

export interface HistoryEntry {
  typeModification?: string | null;
  acte?: string | null;
  dateActe?: string | null;
  article?: string | null;
  acteId?: number | null;
  joncNumero?: string | null;
  jonc?: string | null;
  jorf?: string | null;
}

export interface Alinea {
  id?: number;
  numero?: string | null;
  contenu?: string | null;
}

export interface FileRef {
  id: number;
  nom?: string | null;
  libelle?: string | null;
}

/** Node of `/code/{slug}/contenu-complet`: the whole code as one tree. */
export interface CodeNode {
  id: number;
  type?: Labelled;
  instanceLabel?: string;
  titre?: string | null;
  numero?: string | null;
  slug?: string | null;
  slugCode?: string | null;
  contenu?: string | null;
  note?: string | null;
  statut?: string | null;
  natureModification?: string | null;
  dateApplication?: string | null;
  autoriteDeposante?: string | null;
  listTheme?: { libelle?: string }[] | string[];
  listHistorique?: HistoryEntry[];
  listHistoriqueArticle?: HistoryEntry[];
  listAlinea?: Alinea[];
  listAnnexe?: FileRef[];
  children?: CodeNode[];
}

export interface CodeArticleNavigation {
  code?: { id: number; libelle?: string; slug?: string; dateApplication?: string };
  listAncetre?: { id: number; type?: Labelled; numero?: string; titre?: string; instanceLabel?: string; slug?: string }[];
  article?: {
    id: number;
    numero?: string | null;
    titreArticle?: string | null;
    contenu?: string | null;
    note?: string | null;
    statut?: string | null;
    natureModification?: string | null;
    listHistorique?: HistoryEntry[];
    listAlinea?: Alinea[];
  };
  precedent?: { id: number; numero?: string; slug?: string; instanceLabel?: string } | null;
  suivant?: { id: number; numero?: string; slug?: string; instanceLabel?: string } | null;
  position?: number;
  total?: number;
}

export interface TexteArticle {
  id: number;
  numero?: string | null;
  titreArticle?: string | null;
  contenu?: string | null;
  note?: string | null;
  statut?: string | null;
  natureModification?: string | null;
  ordre?: number;
  listHistorique?: HistoryEntry[];
  listAlinea?: Alinea[];
}

export interface TexteSection {
  id: number;
  type?: string | null;
  numero?: string | null;
  titre?: string | null;
  note?: string | null;
  listPreambule?: { contenu?: string | null }[];
  listArticle?: TexteArticle[];
  listSection?: TexteSection[];
}

export interface TexteConsolide {
  id: number;
  numero?: string | null;
  objet?: string | null;
  date?: string | null;
  dateConsolidation?: string | null;
  autorite?: string | null;
  natureActe?: string | null;
  hasPdf?: boolean;
  listTheme?: string[];
  listHistorique?: HistoryEntry[];
  listPreambule?: { contenu?: string | null }[];
  listArticle?: TexteArticle[];
  listSection?: TexteSection[];
  listTexteApplication?: { id?: number; numero?: string; objet?: string; libelle?: string }[];
  listAnnexe?: FileRef[];
}

export interface TexteArticleNavigation {
  texte?: { id: number; natureActe?: string; numero?: string; objet?: string; autorite?: string; date?: string; dateVersion?: string };
  listAncetre?: { id: number; type?: string; numero?: string; titre?: string }[];
  article?: TexteArticle;
  precedent?: { id: number; numero?: string; titreArticle?: string | null } | null;
  suivant?: { id: number; numero?: string; titreArticle?: string | null } | null;
  position?: number;
  total?: number;
}

export interface Jurisprudence {
  id: number;
  slug: string;
  ordre?: Labelled;
  juridiction?: Labelled;
  typeJurisprudence?: Labelled;
  numeroReference?: string;
  dateAudiencePublique?: string;
  instanceLabel?: string;
  listTheme?: { id: number; libelle: string }[];
  fichierPdf?: FileRef | null;
}

export interface Mention {
  type?: string;
  contenu?: string | null;
}

export interface ActeArticle {
  numeroArticle?: number | string | null;
  titre?: string | null;
  contenu?: string | null;
  listAlinea?: Alinea[];
}

export interface Acte {
  id: number;
  natureActe?: string | null;
  qualificatifNature?: string | null;
  numeroActe?: string | null;
  dateActe?: string | null;
  objet?: string | null;
  emetteur?: string | null;
  autoriteDeposante?: string | null;
  typeCollectivite?: string | null;
  rubriqueJonc?: string | null;
  mentionFait?: string | null;
  intro?: string | null;
  preambule?: string | null;
  dispositif?: string | null;
  importMode?: string | null;
  joncDatePublication?: string | null;
  /** True when `/acte/{id}/pdf` serves the whole JONC issue rather than the act alone. */
  pdfJoncEntier?: boolean;
  erratum?: boolean;
  acteCorrigeId?: number | null;
  acteCorrigeJoncNumero?: string | null;
  listMention?: Mention[];
  listArticle?: ActeArticle[];
  listSignataire?: { prenomNom?: string | null; fonction?: string | null }[];
  listAnnexe?: FileRef[];
}

export interface JoncContenu {
  numeroJonc: string;
  datePublication?: string;
  typeContenu?: 'ACTE' | 'PUBLICATION_LEGALE' | 'ASSOCIATION_FONDATION' | string;
  acte?: Acte;
  publicationLegale?: Record<string, unknown>;
  associationFondation?: Record<string, unknown>;
}

export interface SommaireActe {
  id: number;
  natureActe?: Labelled | null;
  qualificatifNature?: string | null;
  numeroActe?: string | null;
  dateActe?: string | null;
  objet?: string | null;
  autoriteDeposante?: string | null;
  rubriqueJonc?: string | null;
  pageJonc?: number | null;
  erratum?: boolean;
}

export interface SommaireAnalytique {
  joncId?: number;
  numeroJonc: string;
  datePublication?: string;
  statutJonc?: string;
  listActe?: SommaireActe[];
  listPublicationLegale?: Record<string, unknown>[];
  listAssociationFondation?: Record<string, unknown>[];
}

export interface JoncListEntry {
  id: number;
  numero: string;
  datePublication?: string;
  nombreActes?: number;
}

export interface YearCount {
  annee: string;
  nombre: number;
}

export interface Debat {
  id: number;
  numero: string;
  mandature?: number;
  datePremiereSession?: string | null;
  dateDerniereSession?: string | null;
  dateReference?: string | null;
  listSeance?: Record<string, unknown>[];
  listSession?: Record<string, unknown>[];
  listFichierAmendement?: FileRef[];
  listFichierAvisInstances?: FileRef[];
  listFichierRapportCommission?: FileRef[];
  listFichierRapportPresentation?: FileRef[];
}

export interface DebatNavigation {
  debat: Debat;
  precedent?: Debat | null;
  suivant?: Debat | null;
  position?: number;
  total?: number;
}

export interface Catalogue {
  listTypeActe?: { value: string; libelle: string; categoriePublication?: string }[];
  listTypeCollectivite?: { id: number; libelle: string; nombreAutorite?: number }[];
  listAutoriteEmettrice?: { id: number; code?: string; libelle: string; typeCollectiviteId?: number; typeCollectiviteLibelle?: string }[];
  listThematique?: { id: number; libelle: string; type?: string; themePrincipalId?: number | null; ordreAffichage?: number }[];
  listScopeRecherche?: { id: string; libelle: string; tooltip?: string }[];
  listScopeRechercheCode?: { id: string; libelle: string; tooltip?: string }[];
  listScopeRechercheTexteConsolide?: { id: string; libelle: string; tooltip?: string }[];
  listScopeRechercheJurisprudence?: { id: string; libelle: string; tooltip?: string }[];
  listCode?: CodeSummary[];
  listTypeSection?: { id: string; libelle: string }[];
  listOrdreJurisprudence?: { id: string; libelle: string }[];
  listJuridiction?: { id: string; libelle: string; ordre?: string }[];
  listTypeJurisprudence?: { id: string; libelle: string }[];
}
