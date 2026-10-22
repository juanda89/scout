import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

/** Email "results are ready". Usa SES si hay SES_FROM y credenciales AWS; si no, lo registra en consola. */
export async function sendResultsEmail(to: string, scoutingName: string, url: string, summary: string): Promise<void> {
  const from = process.env.SES_FROM;
  if (!from || !process.env.AWS_REGION) { console.log(`[notify] (sin SES) a ${to}: "${scoutingName}" listo → ${url}`); return; }
  const ses = new SESClient({ region: process.env.AWS_REGION });
  await ses.send(new SendEmailCommand({
    Source: from, Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: `Your scouting "${scoutingName}" is ready` },
      Body: {
        Text: { Data: `${summary}\n\nSee the results: ${url}` },
        Html: { Data: `<p>${summary}</p><p><a href="${url}">See the results</a></p>` },
      },
    },
  }));
}
