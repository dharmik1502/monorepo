import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Authorization token required.');
    }

    request.user = await this.authService.verifyToken(token);
    return true;
  }

  private extractToken(request: any): string | null {
    const auth = request.headers?.authorization ?? '';
    const [type, token] = auth.split(' ');
    return type === 'Bearer' ? token : null;
  }
}
