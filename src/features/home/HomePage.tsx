import { useWindowFileDrop } from "@/ui";
import { openDroppedFiles } from "./actions";
import { Hero } from "./Hero";
import { HomeToolsInline } from "./HomeToolsInline";
import { HomeToolsSidebar } from "./HomeToolsSidebar";
import { RecentSection } from "./RecentSection";

export function HomePage() {
  // Dropping PDFs anywhere on the window opens them, not just on the drop zone.
  useWindowFileDrop(openDroppedFiles, ["pdf"]);

  return (
    <div className="flex min-h-0 flex-1">
      <HomeToolsSidebar />
      <main className="min-w-0 flex-1 overflow-y-auto max-md:bg-app">
        <div className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-6 max-md:pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8">
          <Hero />
          <RecentSection />
          {/* Phones have no docked tools column: the same list goes inline. */}
          <HomeToolsInline className="md:hidden" />
        </div>
      </main>
    </div>
  );
}
