import { useWindowFileDrop } from "@/ui";
import { openDroppedFiles } from "./actions";
import { Hero } from "./Hero";
import { HomeToolsSidebar } from "./HomeToolsSidebar";
import { RecentSection } from "./RecentSection";

export function HomePage() {
  // Dropping PDFs anywhere on the window opens them, not just on the drop zone.
  useWindowFileDrop(openDroppedFiles, ["pdf"]);

  return (
    <div className="flex min-h-0 flex-1">
      <HomeToolsSidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
          <Hero />
          <RecentSection />
        </div>
      </main>
    </div>
  );
}
