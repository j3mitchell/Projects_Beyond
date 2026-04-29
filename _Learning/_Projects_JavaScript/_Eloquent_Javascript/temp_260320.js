let num = 7;
let text1 = "";

while (num > 0) {
  text1 += " #";
  console.log(text1);
  num--;
}

const divTest = document.getElementById("div_test");
const pTest = document.getElementById("p_test");

if (divTest) {
  divTest.style.border = "1px solid #999";
  divTest.style.padding = "8px";
}

if (pTest) {
  pTest.textContent = "something else altogether different";
}
