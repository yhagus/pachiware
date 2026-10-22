# Hidden-rules checklist

Frameworks decide much of the contract outside the handler. For each category, find where the repository (and its framework) decides it, at base and at head. The examples are illustrations, not a complete list.

1. **Field names on the wire.** Global naming strategies and alias generators, serializer case transforms, struct tags, `@JsonProperty`-style annotations. *E.g. Jackson `SNAKE_CASE` in `application.yml` turns a field fullName into `full_name`; Pydantic `alias_generator`; Go `json:"..."` tags.*
2. **Presence and null.** How the serializer treats null, undefined, and zero values; conditional inclusion; database column nullability; defaults. *E.g. `undefined` disappears in `JSON.stringify`; Go `omitempty` drops zero values while a pointer without it becomes `null`; Pydantic `exclude_none`; Laravel `when()` / `whenLoaded()` drop the key.*
3. **Status codes.** Framework defaults per method, explicit overrides, and how exceptions map to statuses. *E.g. NestJS `@Post()` returns 201 by default; Laravel turns `ModelNotFoundException` into 404.*
4. **Implicit validation.** Pipes, form requests, validation middleware, decorators, and their global settings: stripping or rejecting unknown fields, coercing query strings to numbers or booleans, and the validation error format. *E.g. NestJS `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`; Laravel FormRequest's automatic 422.*
5. **Wrapping.** Global interceptors, response helpers, resource wrapping, pagination wrappers. *E.g. Laravel `JsonResource` wraps in `data` unless `withoutWrapping()` is called.*
6. **Value formats.** Date format and timezone, decimals or big integers serialized as strings, enums serialized by name or value, ID formats. *E.g. `BigInt`/`Decimal` often become strings; some ORMs return timestamps without a timezone.*
7. **Routing.** Global prefixes, versioning, router mounts, trailing-slash handling, method overrides, file-based routing.
8. **Headers, auth, and cross-cutting middleware.** Auth guards, required headers, CORS allowed origins and headers, rate limiting and its headers, content negotiation, file-upload content types and limits.
9. **Team conventions.** Custom base controllers, response helpers, exception classes, and error-code registries. These differ per repository, so read their implementations instead of assuming.
