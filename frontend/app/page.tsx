import Navbar from "@/components/landing/navbar";
import HeroSection from "@/components/landing/hero-section";
import ArchitectureSection from "@/components/landing/architecture-section";
import FeaturesSection from "@/components/landing/features-section";
import PropertiesSection from "@/components/landing/properties-section";
import TechStackSection from "@/components/landing/tech-stack-section";
import Footer from "@/components/landing/footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main className="pt-16">
        <HeroSection />
        <ArchitectureSection />
        <FeaturesSection />
        <PropertiesSection />
        <TechStackSection />
      </main>
      <Footer />
    </>
  );
}
