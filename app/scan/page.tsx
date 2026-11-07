import PageHeader from "@/components/PageHeader";

export default function Scan() {
  return (
    <>
      <PageHeader title="Scan to pay" />
      <main>
        <div className="viewfinder" aria-hidden>
          <i /><i /><i /><i />
        </div>
        <p className="center-note">Camera access will be connected here.</p>
      </main>
    </>
  );
}
