import type { Metadata } from "next";
import { LegalPage, legalContact, legalEntity, legalLaw } from "@/components/Legal";

export const metadata: Metadata = { title: "Terms of Service — Scout" };
export const dynamic = "force-dynamic";

export default function Terms() {
  const contact = legalContact ? <a href={`mailto:${legalContact}`}>{legalContact}</a> : <span>the contact address of the agency</span>;
  return (
    <LegalPage title="Terms of Service" updated="October 22, 2026">
      <p>These terms govern the use of Scout, a creator scouting tool operated by {legalEntity} (“we”). By signing in you accept them.</p>

      <h2>1. Who can use Scout</h2>
      <p>Scout is an internal professional tool. Access is granted only to accounts authorized by the agency. You must keep your Google account secure and must not share access with anyone outside the agency.</p>

      <h2>2. Permitted use</h2>
      <p>Scout may be used solely to identify and evaluate content creators for marketing campaigns. You agree not to use it to harass, discriminate against or profile individuals for purposes unrelated to a campaign, not to attempt to access non-public data, not to scrape or export the database beyond the campaign reports the product provides, and not to circumvent access controls or rate limits.</p>

      <h2>3. Nature of the results</h2>
      <p>Fit scores, audience estimates and extracted facts are produced automatically from public sources and third-party data. They are estimates intended to support a human decision and may be incomplete or wrong. We do not guarantee their accuracy, completeness or fitness for a particular campaign. You are responsible for verifying information before relying on it and for complying with the terms of the social platforms and with applicable advertising and data protection law in your outreach.</p>

      <h2>4. Availability</h2>
      <p>Scout is provided “as is”. We may change, suspend or discontinue features at any time and perform maintenance without notice. Scoutings consume third-party services with usage costs; we may limit the size or number of scoutings to control those costs.</p>

      <h2>5. Intellectual property</h2>
      <p>The Scout software, its design and its documentation remain the property of their respective owners. Briefs you enter and the reports generated for your campaigns are yours to use for those campaigns. Public content analyzed by Scout remains the property of its authors and platforms.</p>

      <h2>6. Liability</h2>
      <p>To the extent permitted by law, we are not liable for indirect or consequential damages, lost profits or decisions made on the basis of Scout results. Our total liability for any claim is limited to the amount paid for the use of Scout in the preceding three months, if any.</p>

      <h2>7. Privacy</h2>
      <p>How we handle personal data is described in the <a href="/privacy">Privacy Policy</a>, which forms part of these terms.</p>

      <h2>8. Termination</h2>
      <p>We may revoke access at any time for breach of these terms. You may stop using Scout at any time and ask us to delete your account data.</p>

      <h2>9. Governing law and contact</h2>
      <p>These terms are governed by the laws of {legalLaw || "the country where the operating agency is established"}, without prejudice to mandatory consumer or data protection rules. Contact: {contact}.</p>
    </LegalPage>
  );
}
