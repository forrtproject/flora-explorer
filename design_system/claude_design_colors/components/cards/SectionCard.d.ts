export interface SectionCardPalette {
  /** darkest tone — card border, badge background, primary button, swatch #1 */
  dark: string;
  /** mid tone — swatch #2 */
  base: string;
  /** light tone — swatch #3 */
  light: string;
  /** faintest tone — swatch #4, secondary button background */
  faint: string;
}

/**
 * @startingPoint section="Components" subtitle="Themed section card with status badge and color swatches" viewport="380x460"
 */
export interface SectionCardProps {
  /** Section name, e.g. "Explore" — rendered large, serif */
  title: string;
  /** Small muted line under the title, e.g. "Replication Atlas · frozen" */
  subtitle: string;
  /** Status word shown in the pill badge, e.g. "FIXED", "DRAFT", "ACTIVE" */
  status: string;
  /** Four-stop palette this section is themed with */
  palette: SectionCardPalette;
  primaryLabel?: string;
  secondaryLabel?: string;
  linkLabel?: string;
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
  onLinkClick?: () => void;
}
