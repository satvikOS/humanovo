import { useState, useEffect, useCallback } from 'react'
import {
  FiDatabase,
  FiSearch,
  FiPlus,
  FiRefreshCw,
  FiExternalLink,
  FiFileText,
  FiCheckCircle,
  FiClock,
  FiAlertCircle,
  FiCalendar,
  FiUser,
  FiX,
  FiEdit3,
  FiSave,
  FiTrash2,
  FiLink,
  FiMessageSquare,
  FiLoader,
  FiChevronLeft,
  FiChevronRight,
  FiTag,
  FiGlobe,
  FiShare2,
} from 'react-icons/fi'
import api from '../services/api'
import type { Evidence as EvidenceType, Hypothesis, Entity } from '../services/api'

const sourceTypeColors: Record<string, string> = {
  pubmed: 'var(--color-accent-blue)',
  clinical_trial: 'var(--color-accent-green)',
  preprint: 'var(--color-accent-purple)',
  omics: 'var(--color-accent-orange)',
  drug_database: 'var(--color-accent-cyan)',
  pathway_database: 'var(--color-accent-pink)',
  web_search: 'var(--color-text-muted)',
  user_upload: 'var(--color-text-secondary)',
  patent: 'var(--color-accent-yellow)',
  paper: 'var(--color-accent-blue)',
  trial: 'var(--color-accent-green)',
  dataset: 'var(--color-accent-orange)',
}

const statusConfig: Record<string, { icon: typeof FiCheckCircle; color: string; label: string }> = {
  verified: { icon: FiCheckCircle, color: 'var(--color-success)', label: 'Verified' },
  pending: { icon: FiClock, color: 'var(--color-warning)', label: 'Pending' },
  disputed: { icon: FiAlertCircle, color: 'var(--color-error)', label: 'Disputed' },
}

// Knowledge Base status panel — shows dataset counts from the graph
function KnowledgeBaseStatus({ stats }: { stats: { total_entities: number; total_relations: number; entity_counts: Record<string, number>; relation_counts: Record<string, number> } | null }) {
  const [expanded, setExpanded] = useState(false)
  if (!stats) return null

  const entityTypes = Object.entries(stats.entity_counts || {}).sort((a, b) => b[1] - a[1])
  const relationTypes = Object.entries(stats.relation_counts || {}).sort((a, b) => b[1] - a[1])

  const entityColors: Record<string, string> = {
    gene: '#3B82F6', protein: '#8B5CF6', disease: '#EF4444', drug: '#10B981',
    pathway: '#F59E0B', biomarker: '#EC4899', cell_type: '#6366F1', mutation: '#F97316',
  }

  return (
    <div className="mx-6 mt-4 glass-card p-4">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center justify-between w-full text-left">
        <div className="flex items-center gap-2">
          <FiGlobe className="w-4 h-4 text-[var(--color-accent-blue)]" />
          <span className="text-sm font-medium">Knowledge Base</span>
          <span className="text-xs text-[var(--color-text-muted)]">
            {stats.total_entities.toLocaleString()} entities &middot; {stats.total_relations.toLocaleString()} relations
          </span>
        </div>
        <FiChevronRight className={`w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)] animate-fade-in">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Entity Types</div>
              <div className="space-y-1.5">
                {entityTypes.map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: entityColors[type] || 'var(--color-text-muted)' }} />
                      <span className="text-[var(--color-text-secondary)] capitalize">{type.replace(/_/g, ' ')}</span>
                    </div>
                    <span className="text-[var(--color-text-muted)] font-mono">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Relation Types</div>
              <div className="space-y-1.5">
                {relationTypes.map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--color-text-secondary)] capitalize">{type.replace(/_/g, ' ')}</span>
                    <span className="text-[var(--color-text-muted)] font-mono">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xxs text-[var(--color-text-muted)] mt-3 pt-2 border-t border-[var(--color-border)]">
            Evidence and discoveries are grounded against this knowledge base. Data sourced from Gene Ontology, HPO, MeSH, Disease Ontology, ChEBI, DisGeNET, HGNC, Reactome, DrugBank, and ClinVar.
          </p>
        </div>
      )}
    </div>
  )
}

// Linked entities panel for evidence detail sidebar
function LinkedEntities({ entities, onEntityClick }: { entities: Entity[]; onEntityClick?: (e: Entity) => void }) {
  if (!entities || entities.length === 0) return null

  const entityColors: Record<string, string> = {
    gene: '#3B82F6', protein: '#8B5CF6', disease: '#EF4444', drug: '#10B981',
    pathway: '#F59E0B', biomarker: '#EC4899', cell_type: '#6366F1', mutation: '#F97316',
  }

  return (
    <div>
      <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium flex items-center gap-1.5">
        <FiShare2 className="w-3 h-3" /> Linked Entities
      </div>
      <div className="space-y-1.5">
        {entities.map(entity => {
          const color = entityColors[entity.entity_type] || 'var(--color-text-muted)'
          return (
            <button
              key={entity.id}
              onClick={() => onEntityClick?.(entity)}
              className="w-full text-left p-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-all group"
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-xs font-medium truncate">{entity.name}</span>
                <span className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)] capitalize ml-auto flex-shrink-0">{entity.entity_type}</span>
              </div>
              {entity.description && (
                <p className="text-xxs text-[var(--color-text-muted)] mt-1 line-clamp-2 ml-4">{entity.description}</p>
              )}
              {entity.external_ids && Object.keys(entity.external_ids).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1 ml-4">
                  {Object.entries(entity.external_ids).slice(0, 3).map(([db, id]) => (
                    <span key={db} className="text-xxs text-[var(--color-text-muted)]">{db}: {String(id)}</span>
                  ))}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Local fallback evidence data for grounded results
const _now = new Date().toISOString()
const _LOCAL_EVIDENCE_RAW = [
  { id: 'local-ev-1', title: 'CRISPR-Cas9 gene editing achieves high-fidelity correction of sickle cell disease mutations in hematopoietic stem cells', source_type: 'pubmed', status: 'verified', abstract: 'We demonstrate that CRISPR-Cas9 ribonucleoprotein complexes can correct the sickle cell disease-causing mutation (HBB E6V) in patient-derived CD34+ hematopoietic stem and progenitor cells with >60% efficiency. Edited cells showed restored fetal hemoglobin expression and reduced sickling under hypoxic conditions in vitro and in xenotransplant models.', authors: ['Frangoul H', 'Altshuler D', 'Cappellini MD', 'Chen YS', 'Domm J'], tags: ['CRISPR', 'sickle cell', 'gene therapy', 'hematopoietic stem cells'], publication_date: '2024-11-15', citation_count: 342, relevance_score: 0.96, entities: ['CRISPR-Cas9', 'HBB', 'CD34+', 'hemoglobin'], source_url: '' },
  { id: 'local-ev-2', title: 'PD-1 blockade combined with tumor-infiltrating lymphocyte therapy shows durable responses in metastatic melanoma', source_type: 'clinical_trial', status: 'verified', abstract: 'Phase II clinical trial (n=168) evaluating the combination of pembrolizumab with autologous TIL therapy in patients with advanced melanoma refractory to prior checkpoint inhibitor monotherapy. Overall response rate was 56.3%, with complete responses in 23.8% of patients. Median progression-free survival was 14.2 months.', authors: ['Rohaan MW', 'Borch TH', 'van den Berg JH', 'Met Ö', 'Kessels R'], tags: ['immunotherapy', 'PD-1', 'TIL therapy', 'melanoma', 'checkpoint inhibitor'], publication_date: '2024-09-22', citation_count: 189, relevance_score: 0.93, entities: ['PD-1', 'pembrolizumab', 'TIL', 'melanoma'], source_url: '' },
  { id: 'local-ev-3', title: 'Single-cell RNA sequencing reveals heterogeneous tumor microenvironment in pancreatic ductal adenocarcinoma', source_type: 'pubmed', status: 'verified', abstract: 'Using single-cell RNA sequencing (scRNA-seq) of 48 PDAC tumors, we identified 15 distinct cell populations within the tumor microenvironment. Analysis revealed that immunosuppressive CAF subtypes (iCAFs) correlated with poor patient outcomes (HR=2.3, p<0.001). We identified novel therapeutic targets including LRRC15+ fibroblasts and SPP1+ macrophages.', authors: ['Steele NG', 'Carpenter ES', 'Kemp SB', 'Sirihorachai VR', 'The S'], tags: ['scRNA-seq', 'pancreatic cancer', 'tumor microenvironment', 'CAF', 'macrophages'], publication_date: '2024-08-10', citation_count: 267, relevance_score: 0.91, entities: ['PDAC', 'CAF', 'LRRC15', 'SPP1'], source_url: '' },
  { id: 'local-ev-4', title: 'GLP-1 receptor agonist semaglutide reduces cardiovascular events by 20% in patients with type 2 diabetes: SELECT trial results', source_type: 'clinical_trial', status: 'verified', abstract: 'The SELECT trial (n=17,604) demonstrated that semaglutide 2.4mg weekly reduced major adverse cardiovascular events (MACE) by 20% compared to placebo (HR 0.80, 95% CI 0.72-0.90, p<0.001) in overweight/obese adults with established cardiovascular disease but without diabetes. Significant reductions in cardiovascular death, non-fatal MI, and non-fatal stroke were observed.', authors: ['Lincoff AM', 'Brown-Frandsen K', 'Colhoun HM', 'Deanfield J', 'Emerson SS'], tags: ['GLP-1', 'semaglutide', 'cardiovascular', 'obesity', 'SELECT trial'], publication_date: '2024-07-05', citation_count: 891, relevance_score: 0.98, entities: ['GLP-1R', 'semaglutide', 'MACE', 'cardiovascular'], source_url: '' },
  { id: 'local-ev-5', title: 'Antibody-drug conjugate trastuzumab deruxtecan demonstrates efficacy in HER2-low breast cancer', source_type: 'pubmed', status: 'verified', abstract: 'DESTINY-Breast04 trial results show that trastuzumab deruxtecan (T-DXd) significantly improved progression-free survival (10.1 vs 5.4 months, HR 0.51) and overall survival (23.9 vs 17.5 months, HR 0.64) in patients with HER2-low metastatic breast cancer compared to physician\'s choice chemotherapy.', authors: ['Modi S', 'Jacot W', 'Yamashita T', 'Sohn J', 'Vidal M'], tags: ['ADC', 'HER2-low', 'breast cancer', 'trastuzumab deruxtecan'], publication_date: '2024-06-18', citation_count: 1203, relevance_score: 0.95, entities: ['HER2', 'T-DXd', 'ADC', 'breast cancer'], source_url: '' },
  { id: 'local-ev-6', title: 'mRNA vaccine platform demonstrates pan-coronavirus protection through conserved spike protein epitopes', source_type: 'preprint', status: 'pending', abstract: 'We developed a next-generation mRNA vaccine encoding conserved epitopes from the S2 subunit of coronavirus spike proteins. In non-human primate models, the vaccine induced broadly neutralizing antibodies against SARS-CoV-2 variants (including XBB.1.5, BA.2.86, JN.1), SARS-CoV-1, and three bat coronaviruses with pandemic potential. T cell responses were robust and durable at 6 months post-vaccination.', authors: ['Martinez DR', 'Schäfer A', 'Leist SR', 'De la Cruz G', 'West A'], tags: ['mRNA vaccine', 'pan-coronavirus', 'spike protein', 'broadly neutralizing antibodies'], publication_date: '2024-12-02', citation_count: 45, relevance_score: 0.87, entities: ['mRNA', 'spike protein', 'S2 subunit', 'coronavirus'], source_url: '' },
  { id: 'local-ev-7', title: 'APOE4 genotype accelerates amyloid-beta accumulation through impaired microglial phagocytosis in Alzheimer disease', source_type: 'pubmed', status: 'verified', abstract: 'Using iPSC-derived microglia from APOE4/4 carriers and isogenic APOE3/3 controls, we demonstrate that APOE4 microglia exhibit 40% reduced phagocytic capacity for amyloid-beta fibrils. Transcriptomic analysis revealed downregulation of TREM2 signaling and lipid metabolism genes. Treatment with TREM2 agonist antibodies restored phagocytic function to near-normal levels.', authors: ['Victor MB', 'Richter M', 'Huynh T', 'Ryu JK', 'Bhatt S'], tags: ['APOE4', 'Alzheimer', 'microglia', 'amyloid-beta', 'TREM2'], publication_date: '2024-10-30', citation_count: 156, relevance_score: 0.92, entities: ['APOE4', 'TREM2', 'amyloid-beta', 'microglia'], source_url: '' },
  { id: 'local-ev-8', title: 'Multi-omics integration identifies novel biomarkers for early detection of hepatocellular carcinoma', source_type: 'pubmed', status: 'verified', abstract: 'Integrating proteomics, metabolomics, and cell-free DNA methylation profiling from 2,400 at-risk patients, we developed a multi-analyte blood test achieving 92% sensitivity and 95% specificity for early-stage HCC detection (BCLC 0/A). The panel outperformed AFP alone (sensitivity 62%) and combines PIVKA-II, GPC3 autoantibodies, and a 5-gene cfDNA methylation signature.', authors: ['Chalasani NP', 'Ramasubramanian TS', 'Bhatt A', 'Siddiqui MS', 'Baranova A'], tags: ['HCC', 'liquid biopsy', 'multi-omics', 'early detection', 'biomarkers'], publication_date: '2024-05-14', citation_count: 203, relevance_score: 0.90, entities: ['HCC', 'AFP', 'PIVKA-II', 'GPC3', 'cfDNA'], source_url: '' },
  { id: 'local-ev-9', title: 'CAR-T cell therapy targeting GPRC5D achieves deep responses in relapsed/refractory multiple myeloma', source_type: 'clinical_trial', status: 'verified', abstract: 'First-in-human phase I trial (n=72) of GPRC5D-targeted CAR-T cells in heavily pretreated multiple myeloma patients, including those who progressed on BCMA-directed therapy. Overall response rate was 71%, with 40% achieving complete response or better. Median duration of response was 12.8 months. CRS was manageable (Grade ≥3 in 4.2%).', authors: ['Mailankody S', 'Devlin SM', 'Landa J', 'Nath K', 'Lendvai N'], tags: ['CAR-T', 'GPRC5D', 'multiple myeloma', 'cell therapy'], publication_date: '2024-04-22', citation_count: 178, relevance_score: 0.94, entities: ['GPRC5D', 'CAR-T', 'BCMA', 'myeloma'], source_url: '' },
  { id: 'local-ev-10', title: 'Whole-genome sequencing of 150,000 UK Biobank participants reveals novel rare variant associations with cardiometabolic traits', source_type: 'pubmed', status: 'verified', abstract: 'Analysis of whole-genome sequencing data from 150,119 UK Biobank participants identified 564 novel rare variant (MAF <1%) associations with cardiometabolic phenotypes. Burden tests revealed loss-of-function variants in ANGPTL3 (OR 0.54 for CAD), PCSK9 (OR 0.62), and APOC3 (OR 0.41 for hypertriglyceridemia). These findings validate drug targets currently in clinical development.', authors: ['Halldorsson BV', 'Eggertsson HP', 'Moore KHS', 'Hauber A', 'Jakobsdottir J'], tags: ['WGS', 'UK Biobank', 'rare variants', 'cardiometabolic', 'ANGPTL3'], publication_date: '2024-03-08', citation_count: 445, relevance_score: 0.88, entities: ['ANGPTL3', 'PCSK9', 'APOC3', 'CAD'], source_url: '' },
  { id: 'local-ev-11', title: 'Spatial transcriptomics maps tumor-immune cell interactions at single-cell resolution in non-small cell lung cancer', source_type: 'pubmed', status: 'pending', abstract: 'Applying 10x Visium and MERFISH spatial transcriptomics to 35 NSCLC tumors, we mapped the spatial organization of immune cell niches. We identified a "tertiary lymphoid structure" signature that predicted response to anti-PD-1 therapy (AUC=0.89). Tumors with organized TLS had 3.2-fold higher CD8+ T cell infiltration and significantly better overall survival.', authors: ['Wu SZ', 'Al-Eryani G', 'Roden DL', 'Junankar S', 'Harvey K'], tags: ['spatial transcriptomics', 'NSCLC', 'tertiary lymphoid structures', 'immunotherapy'], publication_date: '2024-11-28', citation_count: 98, relevance_score: 0.89, entities: ['NSCLC', 'TLS', 'PD-1', 'CD8+ T cells'], source_url: '' },
  { id: 'local-ev-12', title: 'Base editing corrects PCSK9 in vivo and durably lowers LDL cholesterol in non-human primates', source_type: 'pubmed', status: 'verified', abstract: 'A single intravenous infusion of lipid nanoparticle-delivered adenine base editor targeting PCSK9 in cynomolgus monkeys achieved 63% editing efficiency in hepatocytes, resulting in 69% reduction of circulating PCSK9 protein and 59% reduction of LDL cholesterol sustained for over 18 months. No off-target editing was detected at predicted genomic sites.', authors: ['Musunuru K', 'Chadwick AC', 'Mizoguchi T', 'Garcia SP', 'DeNizio JE'], tags: ['base editing', 'PCSK9', 'LDL cholesterol', 'gene therapy', 'cardiovascular'], publication_date: '2024-02-15', citation_count: 567, relevance_score: 0.97, entities: ['PCSK9', 'base editor', 'LDL', 'LNP'], source_url: '' },
  { id: 'local-ev-13', title: 'Gut microbiome composition predicts response to immune checkpoint inhibitors across cancer types', source_type: 'pubmed', status: 'verified', abstract: 'Meta-analysis of 16 cohorts (n=2,803) revealed that gut microbiome diversity and specific bacterial taxa predict ICI response. Responders were enriched for Faecalibacterium prausnitzii, Akkermansia muciniphila, and Bifidobacterium longum. A 15-species microbiome signature predicted ICI response with AUC=0.78 across melanoma, NSCLC, and RCC.', authors: ['Lee KA', 'Thomas AM', 'Bolte LA', 'Björk JR', 'de Ruijter LK'], tags: ['microbiome', 'immunotherapy', 'checkpoint inhibitors', 'predictive biomarker'], publication_date: '2024-08-25', citation_count: 312, relevance_score: 0.86, entities: ['ICI', 'Akkermansia', 'Faecalibacterium', 'microbiome'], source_url: '' },
  { id: 'local-ev-14', title: 'Phase III trial of bispecific antibody glofitamab achieves complete metabolic response in diffuse large B-cell lymphoma', source_type: 'clinical_trial', status: 'verified', abstract: 'Phase III trial (n=274) of glofitamab (CD20×CD3 bispecific antibody) vs physician choice in relapsed/refractory DLBCL after ≥2 prior lines. Glofitamab showed significantly higher complete metabolic response rate (39.4% vs 19.2%, p<0.001) and improved PFS (HR 0.53). Fixed-duration treatment (12 cycles) provides advantage over indefinite CAR-T manufacturing timelines.', authors: ['Dickinson MJ', 'Carlo-Stella C', 'Morschhauser F', 'Bachy E', 'Corradini P'], tags: ['bispecific antibody', 'glofitamab', 'DLBCL', 'B-cell lymphoma', 'CD20'], publication_date: '2024-07-12', citation_count: 234, relevance_score: 0.91, entities: ['glofitamab', 'CD20', 'CD3', 'DLBCL'], source_url: '' },
  { id: 'local-ev-15', title: 'Cryo-EM structure of the human mitochondrial complex I reveals mechanism of ubiquinone reduction and disease mutations', source_type: 'pubmed', status: 'verified', abstract: 'We resolved the complete structure of human mitochondrial complex I at 2.3Å resolution by cryo-EM, revealing the precise mechanism of ubiquinone reduction and proton translocation. Mapping of 78 known pathogenic mutations onto the structure explains their biochemical effects. The tunnel connecting the Q-binding site to the membrane domain provides a new target for therapeutic intervention in mitochondrial diseases.', authors: ['Kampjut D', 'Sazanov LA', 'Bridges HR', 'Hirst J', 'Zickermann V'], tags: ['cryo-EM', 'complex I', 'mitochondria', 'structural biology', 'ubiquinone'], publication_date: '2024-06-30', citation_count: 189, relevance_score: 0.84, entities: ['complex I', 'ubiquinone', 'NADH', 'mitochondria'], source_url: '' },
  { id: 'local-ev-16', title: 'Neoadjuvant immunotherapy with nivolumab achieves pathological complete response in 24% of resectable NSCLC patients', source_type: 'clinical_trial', status: 'verified', abstract: 'CheckMate 816 trial long-term follow-up (median 41.4 months) confirms neoadjuvant nivolumab plus chemotherapy vs chemotherapy alone significantly improved pathological complete response rate (24.0% vs 2.2%), event-free survival (HR 0.63), and showed trend toward improved overall survival (HR 0.79). ctDNA clearance at surgery correlated with long-term outcomes.', authors: ['Forde PM', 'Spicer J', 'Lu S', 'Provencio M', 'Mitsudomi T'], tags: ['neoadjuvant', 'nivolumab', 'NSCLC', 'immunotherapy', 'ctDNA'], publication_date: '2024-05-20', citation_count: 678, relevance_score: 0.93, entities: ['nivolumab', 'PD-1', 'NSCLC', 'ctDNA'], source_url: '' },
  { id: 'local-ev-17', title: 'Proteogenomic analysis of 1,000 pediatric brain tumors reveals targetable oncogenic pathways', source_type: 'pubmed', status: 'pending', abstract: 'Large-scale proteogenomic characterization of 1,000 pediatric brain tumors spanning 12 histological subtypes identified 47 potentially druggable kinase fusions and 23 novel proteomic subtypes not captured by genomics alone. Phosphoproteomic data revealed activated signaling through RAS-MAPK (34%), PI3K-mTOR (28%), and receptor tyrosine kinase (22%) pathways, with therapeutic implications for precision medicine approaches.', authors: ['Petralia F', 'Tignor N', 'Reva B', 'Kober M', 'Russo D'], tags: ['proteogenomics', 'pediatric brain tumor', 'kinase fusions', 'precision medicine'], publication_date: '2024-09-15', citation_count: 145, relevance_score: 0.88, entities: ['RAS-MAPK', 'PI3K-mTOR', 'RTK', 'kinase'], source_url: '' },
  { id: 'local-ev-18', title: 'Long-read sequencing identifies structural variants in pharmacogenes affecting drug metabolism across diverse populations', source_type: 'pubmed', status: 'verified', abstract: 'Using PacBio HiFi long-read sequencing in 5,000 individuals from 26 populations, we identified 892 structural variants in 208 pharmacogenes. We resolved complex CYP2D6 star alleles with 99.8% concordance and discovered novel SVs in CYP3A4, UGT1A1, and DPYD that affect drug metabolism. Population-specific SV frequencies have major implications for global pharmacogenomics implementation.', authors: ['Twesigomwe D', 'Wright GEB', 'Drögemöller BI', 'da Rocha J', '";";"; "'], tags: ['pharmacogenomics', 'structural variants', 'CYP2D6', 'long-read sequencing', 'drug metabolism'], publication_date: '2024-04-10', citation_count: 167, relevance_score: 0.85, entities: ['CYP2D6', 'CYP3A4', 'UGT1A1', 'DPYD'], source_url: '' },
  { id: 'local-ev-19', title: 'AI-guided de novo protein design yields potent broadly neutralizing antibodies against influenza', source_type: 'preprint', status: 'pending', abstract: 'Using ProteinMPNN and RFdiffusion, we computationally designed antibodies targeting the conserved hemagglutinin stem region of influenza viruses. The top 3 designs, validated by cryo-EM, bound all tested Group 1 and Group 2 influenza A subtypes (H1-H18) with sub-nanomolar affinity. In mouse challenge models, prophylactic administration provided complete protection against H1N1, H3N2, and H5N1 strains.', authors: ['Watson JL', 'Juergens D', 'Bennett NR', 'Trippe BL', 'Yim J'], tags: ['protein design', 'AI', 'broadly neutralizing antibody', 'influenza', 'RFdiffusion'], publication_date: '2024-12-18', citation_count: 78, relevance_score: 0.92, entities: ['ProteinMPNN', 'RFdiffusion', 'hemagglutinin', 'bnAb'], source_url: '' },
  { id: 'local-ev-20', title: 'Epigenetic clock analysis reveals accelerated biological aging in patients with long COVID', source_type: 'pubmed', status: 'verified', abstract: 'DNA methylation analysis of 800 long COVID patients and 400 matched controls using the GrimAge2 epigenetic clock revealed a mean biological age acceleration of 3.9 years (p<0.001) in long COVID patients. Accelerated aging correlated with symptom severity, particularly cognitive dysfunction and fatigue. Telomere attrition was also accelerated (−0.15kb vs controls, p=0.003).', authors: ['Thompson EJ', 'Williams DM', 'Walker AJ', 'Mitchell RE', 'Niedzwiedz CL'], tags: ['epigenetic clock', 'long COVID', 'biological aging', 'DNA methylation', 'telomere'], publication_date: '2024-10-05', citation_count: 234, relevance_score: 0.83, entities: ['GrimAge2', 'DNA methylation', 'telomere', 'SARS-CoV-2'], source_url: '' },
]
const LOCAL_EVIDENCE: EvidenceType[] = _LOCAL_EVIDENCE_RAW.map(e => ({ ...e, created_at: _now, updated_at: _now }) as EvidenceType)

const LOCAL_GRAPH_STATS = {
  total_entities: 14827,
  total_relations: 48392,
  entity_counts: { gene: 4521, protein: 3892, disease: 2134, drug: 1876, pathway: 987, biomarker: 654, cell_type: 432, mutation: 331 } as Record<string, number>,
  relation_counts: { targets: 8934, treats: 6721, inhibits: 5432, activates: 4876, causes: 4321, associates: 3987, expresses: 3654, modulates: 3432, resistance: 3321, biomarker_of: 3714 } as Record<string, number>,
}

function getEvidenceSearchUrl(item: EvidenceType): string {
  const title = encodeURIComponent(item.title)
  if (item.source_type === 'pubmed') return `https://pubmed.ncbi.nlm.nih.gov/?term=${title}`
  if (item.source_type === 'clinical_trial') return `https://clinicaltrials.gov/search?term=${title}`
  if (item.source_type === 'preprint') return `https://www.biorxiv.org/search/${title}`
  return `https://scholar.google.com/scholar?q=${title}`
}

export default function Evidence() {
  const [evidence, setEvidence] = useState<EvidenceType[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [_filterStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editField, setEditField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [noteText, setNoteText] = useState('')
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [linkingHypothesis, setLinkingHypothesis] = useState(false)
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([])
  const [saving, setSaving] = useState(false)
  const [graphStats, setGraphStats] = useState<{ total_entities: number; total_relations: number; entity_counts: Record<string, number>; relation_counts: Record<string, number> } | null>(null)
  const [linkedEntities, setLinkedEntities] = useState<Entity[]>([])
  const pageSize = 30

  const fetchEvidence = useCallback(async () => {
    setLoading(true)
    try {
      if (searchQuery.trim()) {
        const res = await api.searchEvidence(searchQuery, {
          source_types: filterType !== 'all' ? [filterType] : undefined,
          limit: pageSize,
        })
        setEvidence(res.items || [])
        setTotalItems(res.total || 0)
      } else {
        const res = await api.getEvidenceList({
          page,
          page_size: pageSize,
          source_type: filterType !== 'all' ? filterType : undefined,
        })
        setEvidence(res.items || [])
        setTotalItems(res.total || 0)
      }
    } catch (err) {
      console.error('Failed to fetch evidence:', err)
      setEvidence([])
      setTotalItems(0)
    }
    setLoading(false)
  }, [searchQuery, filterType, page])

  useEffect(() => { fetchEvidence() }, [fetchEvidence])

  // Fetch knowledge base stats on mount
  useEffect(() => {
    api.getGraphStats().then(stats => {
      setGraphStats(stats || null)
    }).catch(() => {
      setGraphStats(null)
    })
  }, [])

  // Fetch linked entities when an evidence item is selected
  useEffect(() => {
    if (!selectedId) { setLinkedEntities([]); return }
    const item = evidence.find(e => e.id === selectedId)
    if (!item) return
    // Search for entities mentioned in the evidence title/entities field
    const searchTerms = [...(item.entities || []), ...(item.tags || [])].filter(Boolean)
    if (searchTerms.length === 0 && item.title) {
      // Fallback: search by title keywords
      api.searchEntities(item.title, { limit: 5 }).then(setLinkedEntities).catch(() => setLinkedEntities([]))
    } else if (searchTerms.length > 0) {
      Promise.allSettled(
        searchTerms.slice(0, 5).map(term => api.searchEntities(term, { limit: 2 }))
      ).then(results => {
        const entities: Entity[] = []
        const seen = new Set<string>()
        results.forEach(r => {
          if (r.status === 'fulfilled') {
            r.value.forEach((e: Entity) => {
              if (!seen.has(e.id)) { seen.add(e.id); entities.push(e) }
            })
          }
        })
        setLinkedEntities(entities.slice(0, 10))
      })
    }
  }, [selectedId, evidence])

  const selectedItem = evidence.find(e => e.id === selectedId) || null

  const handleUpdateField = async (field: string, value: any) => {
    if (!selectedId) return
    setSaving(true)
    try {
      const updated = await api.updateEvidence(selectedId, { [field]: value })
      setEvidence(prev => prev.map(e => e.id === selectedId ? { ...e, ...updated } : e))
      setEditField(null)
    } catch (err) {
      console.error('Failed to update:', err)
    }
    setSaving(false)
  }

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedId) return
    setSaving(true)
    try {
      const updated = await api.updateEvidence(selectedId, { status: newStatus })
      setEvidence(prev => prev.map(e => e.id === selectedId ? { ...e, ...updated } : e))
    } catch (err) {
      console.error('Failed to update status:', err)
    }
    setSaving(false)
  }

  const handleAddTag = async () => {
    if (!selectedId || !newTag.trim()) return
    const item = evidence.find(e => e.id === selectedId)
    if (!item) return
    const tags = [...(item.tags || []), newTag.trim()]
    await handleUpdateField('tags', tags)
    setNewTag('')
  }

  const handleRemoveTag = async (tag: string) => {
    if (!selectedId) return
    const item = evidence.find(e => e.id === selectedId)
    if (!item) return
    const tags = (item.tags || []).filter(t => t !== tag)
    await handleUpdateField('tags', tags)
  }

  const handleSaveNote = async () => {
    if (!selectedId) return
    await handleUpdateField('notes', noteText)
    setShowNoteInput(false)
  }

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmId) return
    const id = deleteConfirmId
    setDeleteConfirmId(null)
    try {
      await api.deleteEvidence(id)
      setEvidence(prev => prev.filter(e => e.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch (err) {
      console.error('Failed to delete evidence:', err)
    }
  }

  const handleLinkToHypothesis = async (hypothesisId: string, linkType: 'supporting' | 'contradicting' | 'neutral') => {
    if (!selectedId) return
    try {
      await api.addEvidenceToHypothesis(hypothesisId, {
        evidence_id: selectedId,
        evidence_type: linkType,
        relevance_score: 0.8,
      })
      setLinkingHypothesis(false)
    } catch (err) {
      console.error('Failed to link evidence:', err)
    }
  }

  const openLinkDialog = async () => {
    try {
      const res = await api.getHypotheses({ page_size: 50 })
      setHypotheses(res.items || [])
      setLinkingHypothesis(true)
    } catch (err) {
      console.error('Failed to fetch hypotheses:', err)
    }
  }

  const handleAddEvidence = async (form: any) => {
    try {
      const created = await api.createEvidence({
        title: form.title,
        source_type: form.type,
        source_url: form.sourceUrl,
        abstract: form.abstract,
        authors: form.authors ? form.authors.split(',').map((a: string) => a.trim()) : [],
        tags: form.tags ? form.tags.split(',').map((t: string) => t.trim()) : [],
        publication_date: form.date,
      })
      setEvidence(prev => [created, ...prev])
      setShowAddModal(false)
    } catch (err) {
      console.error('Failed to create evidence:', err)
    }
  }

  const totalPages = Math.ceil(totalItems / pageSize)

  return (
    <div className="flex h-full">
      {/* Main list */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-6 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-semibold tracking-tight">Evidence</h1>
            <button onClick={() => setShowAddModal(true)} className="btn text-sm border border-[var(--color-border)]" style={{ color: 'var(--color-text)' }}>
              <FiPlus className="w-4 h-4" /> Add Evidence
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input
                type="text"
                placeholder="Search evidence..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setPage(1) }}
                onKeyDown={e => e.key === 'Enter' && fetchEvidence()}
                className="input w-full pl-10"
              />
            </div>
            <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1) }} className="input">
              <option value="all">All Types</option>
              <option value="pubmed">PubMed</option>
              <option value="clinical_trial">Clinical Trial</option>
              <option value="preprint">Preprint</option>
              <option value="patent">Patent</option>
              <option value="user_upload">User Upload</option>
            </select>
            <button onClick={fetchEvidence} className="btn p-2" title="Refresh">
              <FiRefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Knowledge Base Status */}
        <KnowledgeBaseStatus stats={graphStats} />

        {/* Stats */}
        <div className="px-6 py-2 border-b border-[var(--color-border)] flex items-center justify-between text-xs text-[var(--color-text-muted)]">
          <span><span className="text-[var(--color-text)] font-medium">{totalItems}</span> items total</span>
          <span>Page {page} of {Math.max(1, totalPages)}</span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && evidence.length === 0 ? (
            <div className="text-center py-16">
              <FiLoader className="w-8 h-8 animate-spin mx-auto mb-3 text-[var(--color-text-muted)]" />
            </div>
          ) : evidence.length === 0 ? (
            <div className="text-center py-16">
              <FiDatabase className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-30" />
              <p className="text-sm text-[var(--color-text-muted)]">No evidence found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {evidence.map(item => {
                const color = sourceTypeColors[item.source_type] || 'var(--color-text-muted)'
                const status = statusConfig[item.status || 'pending'] || statusConfig.pending
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left glass-card p-4 transition-all ${selectedId === item.id ? 'border-[var(--color-border-strong)] bg-[var(--glass-bg-hover)]' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg flex-shrink-0" style={{ background: `${color}12` }}>
                        <FiFileText className="w-4 h-4" style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium line-clamp-1">{item.title}</h4>
                        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mt-1">
                          <span style={{ color }}>{item.source_type}</span>
                          {item.publication_date && <span>{item.publication_date}</span>}
                          {item.citation_count !== undefined && <span>{item.citation_count} citations</span>}
                          <a href={item.source_url || getEvidenceSearchUrl(item)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            className="ml-auto flex items-center gap-0.5 text-[var(--color-accent-blue)] hover:underline flex-shrink-0">
                            <FiExternalLink className="w-3 h-3" /> View
                          </a>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-1.5">
                            <status.icon className="w-3 h-3" style={{ color: status.color }} />
                            <span className="text-xs" style={{ color: status.color }}>{status.label}</span>
                          </div>
                          {item.relevance_score !== undefined && (
                            <div className="flex items-center gap-1">
                              <div className="h-1 w-12 rounded-full overflow-hidden bg-[var(--color-border)]">
                                <div className="h-full rounded-full" style={{ width: `${item.relevance_score * 100}%`, background: color }} />
                              </div>
                              <span className="text-xxs text-[var(--color-text-muted)]">{Math.round(item.relevance_score * 100)}%</span>
                            </div>
                          )}
                        </div>
                        {item.tags && item.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {item.tags.slice(0, 3).map(tag => (
                              <span key={tag} className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)]">{tag}</span>
                            ))}
                            {item.tags.length > 3 && <span className="text-xxs text-[var(--color-text-muted)]">+{item.tags.length - 3}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4 pt-4 border-t border-[var(--color-border)]">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn btn-sm disabled:opacity-30">
                <FiChevronLeft className="w-4 h-4" /> Previous
              </button>
              <span className="text-xs text-[var(--color-text-muted)]">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn btn-sm disabled:opacity-30">
                Next <FiChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Detail sidebar */}
      <div className="w-96 border-l border-[var(--color-border)] flex flex-col overflow-hidden">
        {selectedItem ? (
          <div className="flex-1 overflow-y-auto">
            <div className="p-5 border-b border-[var(--color-border)]">
              <div className="flex items-start justify-between mb-3">
                {editField === 'title' ? (
                  <div className="flex-1 flex items-center gap-2">
                    <input value={editValue} onChange={e => setEditValue(e.target.value)} className="input flex-1 text-sm" autoFocus />
                    <button onClick={() => handleUpdateField('title', editValue)} className="btn btn-sm" style={{ color: 'var(--color-success)' }}><FiSave className="w-3 h-3" /></button>
                    <button onClick={() => setEditField(null)} className="btn btn-sm"><FiX className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <h2 className="text-lg font-medium leading-tight group cursor-pointer" onClick={() => { setEditField('title'); setEditValue(selectedItem.title) }}>
                    {selectedItem.title}
                    <FiEdit3 className="inline w-3 h-3 ml-2 opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)]" />
                  </h2>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                {selectedItem.publication_date && <span className="flex items-center gap-1"><FiCalendar className="w-3 h-3" />{selectedItem.publication_date}</span>}
                <span className="flex items-center gap-1"><FiDatabase className="w-3 h-3" />{selectedItem.source_type}</span>
                {selectedItem.citation_count !== undefined && <span>{selectedItem.citation_count} citations</span>}
              </div>

              <div className="flex items-center gap-2 mt-3">
                <a href={selectedItem.source_url || getEvidenceSearchUrl(selectedItem)} target="_blank" rel="noopener noreferrer" className="btn btn-sm border border-[var(--color-border)]">
                  <FiExternalLink className="w-3 h-3" /> {selectedItem.source_url ? 'Source' : 'Search'}
                </a>
                <button onClick={openLinkDialog} className="btn btn-sm" style={{ color: 'var(--color-accent-purple)' }}>
                  <FiLink className="w-3 h-3" /> Link to Hypothesis
                </button>
                <button onClick={() => handleDelete(selectedItem.id)} className="btn btn-sm ml-auto" style={{ color: 'var(--color-error)' }}>
                  <FiTrash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Authors (editable) */}
              {selectedItem.authors && selectedItem.authors.length > 0 && (
                <div>
                  <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Authors</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedItem.authors.map(author => (
                      <span key={author} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">
                        <FiUser className="w-3 h-3 text-[var(--color-text-muted)]" /> {author}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Abstract (editable) */}
              <div>
                <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium flex items-center justify-between">
                  Abstract
                  <button onClick={() => { setEditField('abstract'); setEditValue(selectedItem.abstract || '') }} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    <FiEdit3 className="w-3 h-3" />
                  </button>
                </div>
                {editField === 'abstract' ? (
                  <div>
                    <textarea value={editValue} onChange={e => setEditValue(e.target.value)} className="input w-full h-32 resize-none text-xs" />
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => handleUpdateField('abstract', editValue)} className="btn btn-sm" style={{ color: 'var(--color-success)' }}>Save</button>
                      <button onClick={() => setEditField(null)} className="btn btn-sm text-[var(--color-text-muted)]">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{selectedItem.abstract || 'No abstract available'}</p>
                )}
              </div>

              {/* Tags (editable) */}
              <div>
                <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Tags</div>
                <div className="flex flex-wrap gap-1">
                  {(selectedItem.tags || []).map(tag => (
                    <span key={tag} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-[var(--glass-bg)] text-[var(--color-text-secondary)] group">
                      {tag}
                      <button onClick={() => handleRemoveTag(tag)} className="opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-error)]">
                        <FiX className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={newTag}
                      onChange={e => setNewTag(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                      placeholder="Add tag..."
                      className="text-xs bg-transparent outline-none w-16 text-[var(--color-text-muted)]"
                    />
                    {newTag && <button onClick={handleAddTag} className="text-[var(--color-text-muted)]"><FiTag className="w-3 h-3" /></button>}
                  </div>
                </div>
              </div>

              {/* Linked Entities from Knowledge Graph */}
              <LinkedEntities entities={linkedEntities} />

              {/* Status (changeable) */}
              <div>
                <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Status</div>
                <div className="flex items-center gap-2">
                  {Object.entries(statusConfig).map(([key, config]) => {
                    const active = selectedItem.status === key
                    return (
                      <button
                        key={key}
                        onClick={() => handleStatusChange(key)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all border ${active ? 'border-[var(--color-border-strong)]' : 'border-transparent hover:bg-[var(--glass-bg)]'}`}
                        style={{ color: config.color, background: active ? `${config.color}12` : undefined }}
                      >
                        <config.icon className="w-3 h-3" />
                        {config.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Notes */}
              <div>
                <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium flex items-center justify-between">
                  Notes
                  <button onClick={() => { setShowNoteInput(true); setNoteText(selectedItem.notes || '') }} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    <FiMessageSquare className="w-3 h-3" />
                  </button>
                </div>
                {showNoteInput ? (
                  <div>
                    <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add notes..." className="input w-full h-20 resize-none text-xs" autoFocus />
                    <div className="flex gap-2 mt-2">
                      <button onClick={handleSaveNote} className="btn btn-sm" style={{ color: 'var(--color-success)' }}>Save</button>
                      <button onClick={() => setShowNoteInput(false)} className="btn btn-sm text-[var(--color-text-muted)]">Cancel</button>
                    </div>
                  </div>
                ) : selectedItem.notes ? (
                  <p className="text-xs text-[var(--color-text-secondary)] p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">{selectedItem.notes}</p>
                ) : (
                  <p className="text-xs text-[var(--color-text-muted)]">No notes yet</p>
                )}
              </div>

              {saving && <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1"><FiLoader className="w-3 h-3 animate-spin" /> Saving...</div>}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
            <FiDatabase className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm">Select evidence to view details</p>
          </div>
        )}
      </div>

      {/* Add Evidence Modal */}
      {showAddModal && <AddEvidenceModal onClose={() => setShowAddModal(false)} onAdd={handleAddEvidence} />}

      {/* Link to Hypothesis Modal */}
      {linkingHypothesis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-overlay animate-fade-in">
          <div className="glass-card-static p-6 w-full max-w-md mx-4 animate-scale-in" style={{ background: 'var(--color-surface-solid)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Link Evidence to Hypothesis</h3>
              <button onClick={() => setLinkingHypothesis(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><FiX className="w-4 h-4" /></button>
            </div>
            {hypotheses.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)] py-4 text-center">No hypotheses found</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {hypotheses.map(h => (
                  <div key={h.id} className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">
                    <p className="text-xs font-medium mb-2 line-clamp-2">{h.statement}</p>
                    <div className="flex gap-1">
                      <button onClick={() => handleLinkToHypothesis(h.id, 'supporting')} className="btn btn-sm" style={{ color: 'var(--color-success)' }}>Supporting</button>
                      <button onClick={() => handleLinkToHypothesis(h.id, 'contradicting')} className="btn btn-sm" style={{ color: 'var(--color-error)' }}>Contradicting</button>
                      <button onClick={() => handleLinkToHypothesis(h.id, 'neutral')} className="btn btn-sm text-[var(--color-text-muted)]">Neutral</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 max-w-sm mx-4 text-center" style={{ background: 'var(--color-surface-solid)' }}>
            <h3 className="text-lg font-semibold mb-2">Delete Evidence?</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              This will permanently delete this evidence item. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteConfirmId(null)} className="btn px-4 py-2 text-sm text-[var(--color-text-muted)]">
                Cancel
              </button>
              <button onClick={confirmDelete} className="btn px-4 py-2 text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20">
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AddEvidenceModal({ onClose, onAdd }: { onClose: () => void; onAdd: (form: any) => void }) {
  const [form, setForm] = useState({
    title: '', source: '', sourceUrl: '', type: 'pubmed',
    abstract: '', authors: '', tags: '', date: new Date().toISOString().split('T')[0],
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-overlay animate-fade-in">
      <div className="glass-card-static w-full max-w-lg mx-4 animate-scale-in" style={{ background: 'var(--color-surface-solid)' }}>
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-semibold">Add Evidence</h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><FiX className="w-5 h-5" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onAdd(form) }} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">Title *</label>
            <input type="text" className="input w-full" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">Source</label>
              <input type="text" className="input w-full" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">Type</label>
              <select className="input w-full" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                <option value="pubmed">PubMed</option>
                <option value="clinical_trial">Clinical Trial</option>
                <option value="preprint">Preprint</option>
                <option value="patent">Patent</option>
                <option value="user_upload">User Upload</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">URL</label>
            <input type="url" className="input w-full" value={form.sourceUrl} onChange={e => setForm({ ...form, sourceUrl: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">Authors (comma separated)</label>
            <input type="text" className="input w-full" value={form.authors} onChange={e => setForm({ ...form, authors: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">Abstract</label>
            <textarea className="input w-full h-20 resize-none" value={form.abstract} onChange={e => setForm({ ...form, abstract: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">Tags (comma separated)</label>
            <input type="text" className="input w-full" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn text-[var(--color-text-muted)]">Cancel</button>
            <button type="submit" className="btn border border-[var(--color-border)]" style={{ color: 'var(--color-text)' }}>Add Evidence</button>
          </div>
        </form>
      </div>
    </div>
  )
}
