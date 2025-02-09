import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
    const acceptLang = req.headers.get('accept-language')?.split(',')[0] || 'en-US';

    const response = NextResponse.next();
    response.headers.set('X-User-Language', acceptLang);
    return response;
}
// Apply middleware to all routes
export const config = {
    matcher: '/:path*',
};
