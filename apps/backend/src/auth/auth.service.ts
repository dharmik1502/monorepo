import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AuthService {
  constructor(private supabase: SupabaseService) {}

  async verifyToken(token: string) {
    const { data, error } = await this.supabase
      .getAdminClient()
      .auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired token.');
    }

    return data.user;
  }

  async signUp(email: string, password: string) {
    const { data, error } = await this.supabase.getClient().auth.signUp({
      email,
      password,
    });

    if (error) throw new UnauthorizedException(error.message);
    return data;
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.supabase
      .getClient()
      .auth.signInWithPassword({ email, password });

    if (error) throw new UnauthorizedException(error.message);
    return data;
  }

  async signOut(token: string) {
    const client = this.supabase.getClientWithToken(token);
    const { error } = await client.auth.signOut();
    if (error) throw new UnauthorizedException(error.message);
    return { message: 'Signed out successfully.' };
  }
}
