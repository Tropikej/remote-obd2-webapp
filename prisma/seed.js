const { PrismaClient } = require("@prisma/client");
const argon2 = require("argon2");

const prisma = new PrismaClient();

const USERS = {
  standard: {
    id: "11111111-1111-1111-1111-111111111111",
    email: "user@e2e.test",
    password: "Password123!",
    role: "user",
    status: "active",
  },
  admin: {
    id: "22222222-2222-2222-2222-222222222222",
    email: "admin@e2e.test",
    password: "Password123!",
    role: "super_admin",
    status: "active",
  },
  disabled: {
    id: "33333333-3333-3333-3333-333333333333",
    email: "disabled@e2e.test",
    password: "Password123!",
    role: "user",
    status: "disabled",
  },
};

const DONGLES = {
  ownedA: {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    deviceId: "DONGLE0000000001",
  },
  ownedB: {
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    deviceId: "DONGLE0000000002",
  },
  offline: {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    deviceId: "DONGLE0000000003",
  },
};

const resetDatabase = async () => {
  await prisma.command.deleteMany();
  await prisma.dongleGroup.deleteMany();
  await prisma.dongleToken.deleteMany();
  await prisma.pairingSession.deleteMany();
  await prisma.canConfig.deleteMany();
  await prisma.dongle.deleteMany();
  await prisma.agentToken.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.emailOutbox.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
};

const seedUsers = async () => {
  const standardHash = await argon2.hash(USERS.standard.password);
  const adminHash = await argon2.hash(USERS.admin.password);
  const disabledHash = await argon2.hash(USERS.disabled.password);

  await prisma.user.create({
    data: {
      id: USERS.standard.id,
      email: USERS.standard.email,
      passwordHash: standardHash,
      role: USERS.standard.role,
      status: USERS.standard.status,
    },
  });

  await prisma.user.create({
    data: {
      id: USERS.admin.id,
      email: USERS.admin.email,
      passwordHash: adminHash,
      role: USERS.admin.role,
      status: USERS.admin.status,
    },
  });

  await prisma.user.create({
    data: {
      id: USERS.disabled.id,
      email: USERS.disabled.email,
      passwordHash: disabledHash,
      role: USERS.disabled.role,
      status: USERS.disabled.status,
    },
  });
};

const seedDongles = async () => {
  const now = new Date();
  await prisma.dongle.createMany({
    data: [
      {
        id: DONGLES.ownedA.id,
        deviceId: DONGLES.ownedA.deviceId,
        ownerUserId: USERS.standard.id,
        ownershipState: "CLAIMED_ACTIVE",
        fwBuild: "e2e-1.0.0",
        lanIp: "192.168.0.10",
        udpPort: 9000,
        lastSeenAt: now,
      },
      {
        id: DONGLES.ownedB.id,
        deviceId: DONGLES.ownedB.deviceId,
        ownerUserId: USERS.standard.id,
        ownershipState: "CLAIMED_ACTIVE",
        fwBuild: "e2e-1.0.0",
        lanIp: "192.168.0.11",
        udpPort: 9001,
        lastSeenAt: now,
      },
      {
        id: DONGLES.offline.id,
        deviceId: DONGLES.offline.deviceId,
        ownershipState: "UNCLAIMED",
        fwBuild: "e2e-1.0.0",
      },
    ],
  });
};

const main = async () => {
  await resetDatabase();
  await seedUsers();
  await seedDongles();
};

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("E2E seed completed.");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
