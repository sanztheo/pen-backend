declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
      };
    }
  }
}

export {}; 

// Shims for untyped modules used at runtime
declare module 'pdf-parse/lib/pdf-parse.js' {
  const value: any;
  export default value;
}
declare module 'pdf-parse' {
  const value: any;
  export default value;
}