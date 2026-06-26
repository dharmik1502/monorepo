import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (token) {
      try {
        request.user = await this.authService.verifyToken(token);
      } catch {
        // Token invalid — continue as guest (don't throw)
      }
    }

    return true;
  }

  private extractToken(request: any): string | null {
    const auth = request.headers?.authorization ?? '';
    const [type, token] = auth.split(' ');
    return type === 'Bearer' ? token : null;
  }
}
