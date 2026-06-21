interface BackToRecipiesProps {
  href: string;
}

export const BackToRecipies = ({ href }: BackToRecipiesProps) => {
  return (
    <a href={href} className="text-muted-foreground hover:text-foreground text-sm transition-colors">
      ← Wróć do przepisów
    </a>
  );
};
