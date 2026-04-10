package com.example.invoices.contract;

import au.com.dius.pact.provider.junitsupport.Provider;
import au.com.dius.pact.provider.junitsupport.State;
import au.com.dius.pact.provider.junitsupport.loader.PactFolder;
import au.com.dius.pact.provider.junit5.PactVerificationContext;
import au.com.dius.pact.provider.junit5.PactVerificationInvocationContextProvider;
import org.junit.jupiter.api.TestTemplate;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.context.SpringBootTest;

@Provider("invoices-provider")
@PactFolder("src/test/resources/pacts")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT)
class InvoiceProviderPactTest {

  @TestTemplate
  @ExtendWith(PactVerificationInvocationContextProvider.class)
  void verifyPacts(PactVerificationContext context) {
    context.verifyInteraction();
  }

  @State("invoice exists")
  void invoiceExists() {
  }
}
