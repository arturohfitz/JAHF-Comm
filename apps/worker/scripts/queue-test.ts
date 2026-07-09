import { prisma } from "@jahf-comm/db";
import {
  CLASSIFY_CONVERSATION_MESSAGE_JOB,
  createAiClassificationJobId,
  createAiClassificationQueue
} from "@jahf-comm/shared";

const queue = createAiClassificationQueue();

try {
  const message = await prisma.message.findFirst({
    where: {
      tenant: {
        slug: "jahf-demo"
      },
      direction: "INBOUND"
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tenantId: true,
      conversationId: true,
      contactId: true,
      text: true
    }
  });

  if (!message) {
    throw new Error("No inbound demo message found. Run pnpm webhook:simulate first.");
  }

  const payload = {
    tenantId: message.tenantId,
    messageId: message.id,
    conversationId: message.conversationId,
    contactId: message.contactId
  };
  const jobId = createAiClassificationJobId(payload);
  const existingJob = await queue.getJob(jobId);

  if (!existingJob) {
    await queue.add(CLASSIFY_CONVERSATION_MESSAGE_JOB, payload, { jobId });
  }

  const job = await queue.getJob(jobId);
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        jobId,
        jobState: job ? await job.getState() : "missing",
        message: message.text,
        counts,
        note:
          counts.active > 0 || counts.completed > 0
            ? "El worker parece estar procesando o ya proceso trabajos."
            : "Job encolado. Ejecuta pnpm worker:dev en otra terminal para procesarlo."
      },
      null,
      2
    )
  );
} finally {
  await queue.close();
  await queue.disconnect();
  await prisma.$disconnect();
}
