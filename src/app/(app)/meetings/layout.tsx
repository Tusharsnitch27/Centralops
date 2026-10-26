import { SectionTabs } from "@/components/shell/SectionTabs";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><SectionTabs section="others" prefix />{children}</>;
}
