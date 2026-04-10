package {{PACKAGE_NAME}};

import au.com.dius.pact.provider.junitsupport.Provider;
import au.com.dius.pact.provider.junitsupport.target.HttpTestTarget;
import au.com.dius.pact.provider.junit5.PactVerificationContext;
import au.com.dius.pact.provider.junit5.PactVerificationInvocationContextProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.TestTemplate;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.context.SpringBootTest;

@Provider("{{PROVIDER_NAME}}")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT)
class {{HARNESS_CLASS_NAME}} {

  @BeforeEach
  void beforeEach(PactVerificationContext context) {
    context.setTarget(new HttpTestTarget("localhost", 8080));
  }

  @TestTemplate
  @ExtendWith(PactVerificationInvocationContextProvider.class)
  void verifyPacts(PactVerificationContext context) {
    context.verifyInteraction();
  }

  // Bootstrap note: this harness is a deterministic provider-side baseline only.
  // Pact artifact retrieval is intentionally unresolved here.
  // Add @PactFolder or @PactBroker only after repo evidence grounds the artifact source.
  // Add concrete @State handlers only after real pact interactions expose grounded state names.
}
