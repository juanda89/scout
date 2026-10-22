import type { Metadata } from "next";
import { LegalPage, legalContact, legalEntity } from "@/components/Legal";

export const metadata: Metadata = { title: "Privacy Policy — Scout" };
export const dynamic = "force-dynamic";

export default function Privacy() {
  const contact = legalContact ? <a href={`mailto:${legalContact}`}>{legalContact}</a> : <span>the contact address of the agency</span>;
  return (
    <LegalPage title="Privacy Policy" updated="October 22, 2026">
      <p>Scout is an internal tool used by influencer marketing agencies to find content creators that fit a brand brief. This policy explains what data Scout processes, why, and what rights you have. Scout is operated by {legalEntity}. Questions and requests: {contact}.</p>

      <h2>1. People who sign in to Scout</h2>
      <p>When you sign in with Google we receive your email address, your name and your profile picture. We use them only to authenticate you, to restrict access to the people on the agency’s allowed list, and to record who created each scouting. We do not sell or share this information, and we do not send marketing emails. If you turn on result notifications, we email you when a scouting finishes.</p>
      <p>We store a session cookie strictly necessary for authentication. No advertising or analytics cookies are used.</p>

      <h2>2. Content creators analyzed by Scout</h2>
      <p>To evaluate how well a creator fits a brief, Scout processes <strong>publicly available</strong> information from Instagram, TikTok and YouTube profiles: the profile biography, public posts and captions, public engagement metrics (followers, likes, comments) and, through a third-party provider, aggregated and estimated audience statistics (country, age and gender distributions). Scout does not access private accounts, direct messages or any data that requires the creator’s login.</p>
      <p>From this public content Scout extracts structured facts (for example the topics a creator publishes about, the language of the content or the city a creator states in their biography). Every fact is stored together with the quotation and date of the public post that supports it, so that it can be reviewed and corrected by a person.</p>
      <p><strong>Children.</strong> Some briefs concern parents. In that case Scout may record that a creator has mentioned a child and the age range the creator publicly stated. Scout never records names, images, physical descriptions or locations of children, and never attempts to identify them.</p>
      <p>Creators are not profiled for automated decisions with legal effects. Fit scores are estimates intended to help a human team decide whom to contact; the agency reviews them before any outreach.</p>

      <h2>3. Service providers</h2>
      <ul>
        <li><strong>Google</strong> (sign-in identity).</li>
        <li><strong>Amazon Web Services</strong> (hosting and database, region us-east-1, United States).</li>
        <li><strong>Apify</strong> (collection of public social media content).</li>
        <li><strong>CreatorDB</strong> (aggregated audience statistics).</li>
        <li><strong>OpenRouter / Google Gemini</strong> and <strong>TypeSafe AI</strong> (automated classification and extraction of facts from public text). Content is sent for processing only; it is not used by these providers to train models under our agreements.</li>
      </ul>
      <p>Each provider processes data on our instructions and under its own security commitments. Data may be processed in the United States.</p>

      <h2>4. Retention</h2>
      <p>Account data is kept while the agency’s workspace is active and deleted within 30 days of a deletion request. Creator facts and scouting results are kept while they remain useful for the agency’s campaigns and are deleted on request. Facts about creators are refreshed from public sources; outdated facts are superseded, never silently edited.</p>

      <h2>5. Your rights</h2>
      <p>Whether you are a Scout user or a creator whose public content was analyzed, you can ask us to access, correct or delete the information we hold about you, or to stop processing it, by writing to {contact}. Creators can also ask to be excluded from future scoutings. We answer within 30 days.</p>

      <h2>6. Security</h2>
      <p>Data is transmitted over HTTPS and stored in access-controlled infrastructure. Access to Scout is limited to the agency’s allowed accounts. Credentials for third-party providers are never exposed to the browser.</p>

      <h2>7. Changes</h2>
      <p>We will update this page when our practices change and revise the date above. Material changes are communicated to signed-in users.</p>
    </LegalPage>
  );
}
