import NextAuth, { type NextAuthOptions, type Session } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { queryOne } from './db'

export interface AppUser {
  id: string
  username: string
  display_name: string | null
  role: 'admin' | 'gom' | 'joiner'
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null

        const user = await queryOne<{
          id: string; username: string; display_name: string | null
          password_hash: string; role: string
        }>(
          'SELECT id, username, display_name, password_hash, role FROM profiles WHERE username = $1',
          [credentials.username]
        )

        if (!user) return null

        const valid = await bcrypt.compare(credentials.password, user.password_hash)
        if (!valid) return null

        return {
          id: user.id,
          name: user.display_name || user.username,
          email: user.username,   // repurpose email field for username
          role: user.role,
          username: user.username,
          display_name: user.display_name,
        }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as any).role
        token.username = (user as any).username
        token.display_name = (user as any).display_name
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).id = token.id as string
        ;(session.user as any).role = token.role as string
        ;(session.user as any).username = token.username as string
        ;(session.user as any).display_name = token.display_name as string
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET,
}
