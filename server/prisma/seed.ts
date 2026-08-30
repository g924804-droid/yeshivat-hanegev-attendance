import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const name = process.env.SEED_ADMIN_NAME || 'מנהל מערכת';
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';

  const existing = await prisma.user.findFirst({ where: { role: 'מנהל' } });
  if (existing) {
    console.log(`כבר קיים מנהל במערכת: ${existing.name}`);
    return;
  }

  const admin = await prisma.user.create({
    data: {
      name,
      email,
      role: 'מנהל',
      department: 'ניהול',
      isActive: true,
      dailyRequiredHours: 8,
    },
  });

  console.log(`נוצר משתמש מנהל: ${admin.name} (${admin.id})`);
  console.log(
    'כדי להתחבר איתו יש להוסיף רשומה בטבלת "passwords" ב-Airtable עם שדה "שם המשתמש" = ' +
      `"${admin.name}" ו-"סיסמה מאוחדת" = הסיסמה הרצויה, ו"גישה למערכת" = "מאושר".`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
