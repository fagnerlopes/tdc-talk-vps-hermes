import { NextResponse, type NextRequest } from 'next/server';
import { hashPassword, prisma } from '@hermes/database';

import { getSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

const MIN_PASSWORD = 12;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Revalida no servidor. NAO confia em a UI ter escondido o botao: um POST
  // direto de fora chega exatamente aqui.
  const session = await getSession();
  if (session === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let email = '';
  let name = '';
  let password = '';

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.email === 'string') email = body.email.trim().toLowerCase();
    if (typeof body.name === 'string') name = body.name.trim();
    if (typeof body.password === 'string') password = body.password;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!email.includes('@') || name === '') {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 });
  }

  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      {
        error: 'weak_password',
        message: `A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`,
      },
      { status: 400 },
    );
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing !== null) {
    return NextResponse.json(
      { error: 'email_taken', message: 'Ja existe um admin com esse e-mail.' },
      { status: 409 },
    );
  }

  const created = await prisma.adminUser.create({
    data: { email, name, passwordHash: await hashPassword(password) },
    select: { id: true, email: true, name: true },
  });

  return NextResponse.json(created, { status: 201 });
}
